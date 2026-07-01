import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'
import logger from '@adonisjs/core/services/logger'
import Viaje from '#models/viaje'
import Conductor from '#models/conductor'
import Ganancia from '#models/ganancia'
import User from '#models/user'
import TripStateMachine, { type EstadoViaje } from '#services/trip_state_machine'

/**
 * TripFinalizationService
 *
 * PROPÓSITO
 * ─────────
 * Centraliza TODA la lógica financiera de cierre de viaje en un único
 * punto de entrada. Ningún controlador ni socket debe ejecutar operaciones
 * de dinero directamente: deben llamar a este servicio.
 *
 * GARANTÍAS
 * ─────────
 * 1. IDEMPOTENCIA — Si el viaje ya tiene estado "finalizado" devuelve el
 *    resultado anterior sin volver a ejecutar nada. Safe para reintentos.
 *
 * 2. ATOMICIDAD — Ganancia, deuda y contador de viajes se crean/actualizan
 *    dentro de una sola transacción de base de datos. Si cualquier paso
 *    falla, todo se revierte: nunca queda un estado parcial.
 *
 * 3. BLOQUEO PESIMISTA — La fila del viaje se selecciona con FOR UPDATE
 *    dentro de la transacción. Esto impide que dos procesos simultáneos
 *    (ej. cliente y conductor confirmando al mismo tiempo, o dos instancias
 *    del backend procesando el mismo request) puedan cerrar el mismo viaje
 *    dos veces. El segundo proceso queda bloqueado hasta que el primero
 *    hace COMMIT, luego re-lee el estado "finalizado" y devuelve sin operar.
 *
 * 4. UNICIDAD A NIVEL DB — La migración 1780200000001 agrega UNIQUE en
 *    ganancias.viaje_id. Aunque el código ya protege la doble creación,
 *    la DB es la última línea de defensa ante condiciones de carrera
 *    extremas (crash entre INSERT y COMMIT, múltiples pods sin Redis).
 *
 * 5. VALIDACIÓN DE DISPUTA — Si existe una disputa activa (abierta o
 *    en_revision) el cierre se bloquea completamente.
 *
 * USO
 * ───
 * import TripFinalizationService from '#services/trip_finalization_service'
 *
 * const result = await TripFinalizationService.finalize({
 *   viajeId: params.id,
 *   montoFinal: data.montoFinal,
 *   actorUserId: user.id,
 *   actorRol: user.rol,
 * })
 *
 * if (!result.ok) {
 *   return response.status(result.statusCode).send({ error: result.error })
 * }
 * // result.viaje contiene el viaje ya finalizado
 */

export interface FinalizeInput {
  viajeId: number | string
  montoFinal: number
  actorUserId: number
  actorRol: string
}

export interface FinalizeResult {
  ok: true
  idempotent: boolean    // true = ya estaba finalizado, se devuelve resultado cacheado
  viaje: {
    id: string
    estado: string
    montoFinal: number | null
    finalizadoAt: string | null
  }
}

export interface FinalizeError {
  ok: false
  statusCode: number
  error: string
}

export type FinalizeResponse = FinalizeResult | FinalizeError

export default class TripFinalizationService {

  static async finalize(input: FinalizeInput): Promise<FinalizeResponse> {
    const viajeId = Number(input.viajeId)

    // ─── FASE 0: Verificación rápida sin transacción ──────────────────────
    // Si ya está finalizado devolvemos inmediatamente sin abrir transacción.
    // Esto maneja reintentos de red sin coste de bloqueo.
    const viajePrecheck = await Viaje.find(viajeId)
    if (!viajePrecheck) {
      return { ok: false, statusCode: 404, error: 'Viaje no encontrado' }
    }
    if (viajePrecheck.estado === 'finalizado') {
      return {
        ok: true,
        idempotent: true,
        viaje: {
          id: String(viajePrecheck.id),
          estado: viajePrecheck.estado,
          montoFinal: viajePrecheck.precioFinal,
          finalizadoAt: viajePrecheck.finalizadoAt?.toISO() ?? null,
        },
      }
    }

    // ─── FASE 1: Transacción con bloqueo pesimista ────────────────────────
    try {
      const resultado = await db.transaction(async (trx) => {

        // SELECT ... FOR UPDATE: bloquea la fila hasta que la trx termine.
        // Dos llamadas concurrentes al mismo viajeId se serializan aquí.
        const viaje = await Viaje.query({ client: trx })
          .where('id', viajeId)
          .forUpdate()          // <── bloqueo pesimista
          .firstOrFail()

        // ─── Revalidar estado DENTRO de la transacción ────────────────────
        // El estado pudo cambiar entre el precheck y el lock.
        if (viaje.estado === 'finalizado') {
          // Ya fue finalizado por el proceso concurrente que ganó el lock.
          return {
            idempotent: true,
            viaje,
          }
        }

        // ─── Validar disputa activa ────────────────────────────────────────
        const disputaActiva = await trx
          .from('disputas')
          .where('viaje_id', viajeId)
          .whereIn('estado', ['abierta', 'en_revision'])
          .first()

        if (disputaActiva) {
          throw Object.assign(
            new Error('DISPUTA_ACTIVA'),
            { statusCode: 409, message: 'El viaje tiene una disputa activa. No se puede finalizar hasta que el administrador la resuelva.' }
          )
        }

        // ─── Validar transición de estado ─────────────────────────────────
        if (!TripStateMachine.validarTransicion(viaje.estado as EstadoViaje, 'finalizado')) {
          throw Object.assign(
            new Error('ESTADO_INVALIDO'),
            {
              statusCode: 422,
              message: `El viaje debe estar 'completado' o 'esperando_confirmacion' antes de finalizar (estado actual: ${viaje.estado})`,
            }
          )
        }

        // ─── Validar que quien finaliza tiene permisos ────────────────────
        if (input.actorRol === 'conductor') {
          const conductor = await Conductor.query({ client: trx })
            .where('usuario_id', input.actorUserId)
            .firstOrFail()
          if (viaje.conductorId !== conductor.id) {
            throw Object.assign(
              new Error('SIN_PERMISO'),
              { statusCode: 403, message: 'No eres el conductor asignado a este viaje' }
            )
          }
        } else if (input.actorRol === 'cliente') {
          if (viaje.clienteId !== input.actorUserId) {
            throw Object.assign(
              new Error('SIN_PERMISO'),
              { statusCode: 403, message: 'Este viaje no te pertenece' }
            )
          }
        } else if (input.actorRol !== 'admin') {
          throw Object.assign(
            new Error('SIN_PERMISO'),
            { statusCode: 403, message: 'No tienes permisos para finalizar este viaje' }
          )
        }

        // ─── Verificar que no exista ya una ganancia para este viaje ──────
        // Última guarda de aplicación antes del UNIQUE de la DB.
        const gananciaExistente = await trx
          .from('ganancias')
          .where('viaje_id', viajeId)
          .first()

        if (gananciaExistente) {
          // Esto no debería ocurrir nunca si el UNIQUE está en la DB,
          // pero lo tratamos como idempotente por seguridad.
          logger.warn(`TripFinalizationService: ganancia ya existente para viaje ${viajeId} — posible reintento tardío`)
          viaje.estado = 'finalizado'
          viaje.precioFinal = input.montoFinal
          viaje.finalizadoAt = viaje.finalizadoAt ?? DateTime.now()
          await viaje.useTransaction(trx).save()
          return { idempotent: true, viaje }
        }

        // ════════════════════════════════════════════════════════════════════
        // BLOQUE FINANCIERO — todo o nada dentro de la misma transacción
        // ════════════════════════════════════════════════════════════════════

        // 1. Cerrar el viaje
        viaje.estado = 'finalizado'
        viaje.precioFinal = input.montoFinal
        viaje.finalizadoAt = DateTime.now()
        await viaje.useTransaction(trx).save()

        if (viaje.conductorId) {
          const montoBruto = input.montoFinal
          const comision = Math.round(montoBruto * 0.1 * 100) / 100
          const montoNeto = Math.round((montoBruto - comision) * 100) / 100

          // 2. Crear registro de ganancia (UNIQUE en viaje_id lo protege)
          await Ganancia.create(
            {
              conductorId: viaje.conductorId,
              viajeId: viaje.id,
              monto: montoNeto,
              montoBruto,
              comision,
              montoNeto,
              comisionPagada: false,
            },
            { client: trx }
          )

          // 3. Actualizar contador y estado online del conductor
          const conductor = await Conductor.query({ client: trx })
            .where('id', viaje.conductorId)
            .forUpdate()
            .firstOrFail()

          conductor.totalViajes += 1
          conductor.online = true
          await conductor.useTransaction(trx).save()

          // 4. Acumular deuda de comisión en el usuario del conductor
          const conductorUser = await User.query({ client: trx })
            .where('id', conductor.usuarioId)
            .forUpdate()
            .firstOrFail()

          const deudaAnterior = Number(conductorUser.montoDeuda) || 0
          conductorUser.montoDeuda = Math.round((deudaAnterior + comision) * 100) / 100
          conductorUser.tieneDeudaActiva = true

          // La fecha límite se fija solo en el primer viaje sin pagar.
          // Si ya tiene una fecha activa, no se reinicia.
          if (!conductorUser.deudaFechaLimite) {
            conductorUser.deudaFechaLimite = DateTime.now().plus({ days: 15 })
          }

          await conductorUser.useTransaction(trx).save()
        }

        // 5. Actualizar reputación del cliente
        const cliente = await User.query({ client: trx })
          .where('id', viaje.clienteId)
          .forUpdate()
          .firstOrFail()

        cliente.totalViajesCompletados += 1

        // ── Use Number() to coerce DECIMAL strings from MySQL into numbers ──
        // mysql2 returns DECIMAL columns as strings (e.g. "4.0"), so direct
        // arithmetic ("4.0" + 0.1) produces string concatenation → "4.00.1"
        // and Math.min(5.0, "4.00.1") → NaN, which MySQL rejects.
        const reputacion = Number(cliente.reputacion) || 0
        if (cliente.totalViajesCompletados % 10 === 0 && reputacion < 5.0) {
          cliente.reputacion = Math.min(5.0, reputacion + 0.5)
        }
        if (cliente.totalViajesCompletados >= 1 && reputacion < 5.0) {
          cliente.reputacion = Math.min(5.0, reputacion + 0.1)
        }
        await cliente.useTransaction(trx).save()

        // ════════════════════════════════════════════════════════════════════
        // FIN DEL BLOQUE FINANCIERO
        // ════════════════════════════════════════════════════════════════════

        return { idempotent: false, viaje }
      })

      return {
        ok: true,
        idempotent: resultado.idempotent,
        viaje: {
          id: String(resultado.viaje.id),
          estado: resultado.viaje.estado,
          montoFinal: resultado.viaje.precioFinal,
          finalizadoAt: resultado.viaje.finalizadoAt?.toISO() ?? null,
        },
      }

    } catch (err: any) {

      // Errores de negocio lanzados dentro de la transacción
      if (err?.statusCode) {
        return { ok: false, statusCode: err.statusCode, error: err.message }
      }

      // Error de base de datos: violación del UNIQUE constraint en viaje_id
      // MySQL: errno 1062, SQLite: UNIQUE constraint failed
      if (err?.code === 'ER_DUP_ENTRY' || err?.message?.includes('UNIQUE constraint failed')) {
        logger.warn(`TripFinalizationService: UNIQUE violation en ganancias para viaje ${viajeId} — reintento detectado, respondiendo idempotente`)
        const viaje = await Viaje.find(viajeId)
        return {
          ok: true,
          idempotent: true,
          viaje: {
            id: String(viaje?.id ?? viajeId),
            estado: viaje?.estado ?? 'finalizado',
            montoFinal: viaje?.precioFinal ?? null,
            finalizadoAt: viaje?.finalizadoAt?.toISO() ?? null,
          },
        }
      }

      logger.error({ err, viajeId }, 'TripFinalizationService: error inesperado')
      return { ok: false, statusCode: 500, error: 'Error interno al finalizar el viaje. Por favor contacta al administrador.' }
    }
  }
}
