import { DateTime } from 'luxon'
import logger from '@adonisjs/core/services/logger'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import Conductor from '#models/conductor'
import ConfiguracionPlataforma from '#models/configuracion_plataforma'
import CuponComision from '#models/cupon_comision'
import Ganancia from '#models/ganancia'
import LogFraude from '#models/log_fraude'
import Notificacion from '#models/notificacion'
import Referido from '#models/referido'
import User from '#models/user'
import Viaje from '#models/viaje'
import { sendToToken } from '#services/push_notification_service'
import { baseCodigo, codigoLibre } from '#services/codigo_referido'

/**
 * Programa de referidos (fase 1): único lugar con sus reglas.
 *
 *   • Al registrarse con un código válido queda un `Referido` pendiente.
 *   • Al aprobar al invitado corren `diasMeta` y recibe su cupón (invitado.pct × invitado.viajes).
 *   • Cada cierre de viaje con cupón vigente cobra `pct` en vez del 10 % (descuentoPara), con
 *     tope mensual de comisión no cobrada (topeMensualPesos).
 *   • Cuando el invitado completa `viajesMeta` viajes (con clientes distintos si
 *     clientesDistintos, sin cierres fuera de destino) antes de vencer, el referido pasa a
 *     activo y el referidor recibe su cupón (referidor.pct × referidor.viajes, diasUso días).
 *   • Sin cron: los vencimientos se calculan al leer o al aplicar.
 */

export const COMISION_PCT = 10

export interface ReferidosConfig {
  activo: boolean
  viajesMeta: number
  clientesDistintos: boolean
  diasMeta: number
  invitado: { pct: number; viajes: number }
  referidor: { pct: number; viajes: number; diasUso: number }
  maxPremiosConductorMes: number
  topeMensualPesos: number
}

export const REFERIDOS_DEFAULT: ReferidosConfig = {
  activo: false,
  viajesMeta: 3,
  clientesDistintos: true,
  diasMeta: 30,
  invitado: { pct: 5, viajes: 3 },
  referidor: { pct: 0, viajes: 3, diasUso: 30 },
  maxPremiosConductorMes: 5,
  topeMensualPesos: 500000,
}

export function mezclarReferidos(guardada: unknown): ReferidosConfig {
  const g = (guardada && typeof guardada === 'object' ? guardada : {}) as Partial<ReferidosConfig>
  return {
    ...REFERIDOS_DEFAULT,
    ...g,
    invitado: { ...REFERIDOS_DEFAULT.invitado, ...(g.invitado ?? {}) },
    referidor: { ...REFERIDOS_DEFAULT.referidor, ...(g.referidor ?? {}) },
  }
}

/** Dentro de una transacción hay que pasar `trx` (SQLite en tests tiene una sola conexión). */
export async function referidosConfig(trx?: TransactionClientContract): Promise<ReferidosConfig> {
  const config = await ConfiguracionPlataforma.query({ client: trx }).orderBy('id', 'asc').first()
  return mezclarReferidos(config?.referidos)
}

/** Valida lo que manda el admin (PUT /api/admin/config). Acepta parciales. */
export function validarReferidos(
  entrada: unknown,
  actual: ReferidosConfig
): { valor: ReferidosConfig } | { error: string } {
  if (!entrada || typeof entrada !== 'object' || Array.isArray(entrada)) {
    return { error: 'referidos debe ser un objeto' }
  }
  const e = entrada as Record<string, unknown>
  const cfg: ReferidosConfig = { ...actual, invitado: { ...actual.invitado }, referidor: { ...actual.referidor } }

  const numero = (ruta: string, v: unknown, min: number, max: number): number | string => {
    const n = Number(v)
    if (v === null || v === '' || !Number.isFinite(n) || n < min || n > max) {
      return `${ruta} debe estar entre ${min} y ${max}`
    }
    return Math.round(n)
  }
  for (const [campo, min, max] of [
    ['viajesMeta', 1, 20],
    ['diasMeta', 1, 365],
    ['maxPremiosConductorMes', 1, 100],
    ['topeMensualPesos', 0, 100000000],
  ] as Array<['viajesMeta' | 'diasMeta' | 'maxPremiosConductorMes' | 'topeMensualPesos', number, number]>) {
    if (e[campo] === undefined) continue
    const r = numero(campo, e[campo], min, max)
    if (typeof r === 'string') return { error: r }
    cfg[campo] = r
  }
  for (const campo of ['activo', 'clientesDistintos'] as const) {
    if (e[campo] === undefined) continue
    if (typeof e[campo] !== 'boolean') return { error: `${campo} debe ser true o false` }
    cfg[campo] = e[campo] as boolean
  }
  const rangosAnidados: Record<'invitado' | 'referidor', Array<[string, number, number]>> = {
    invitado: [['pct', 0, COMISION_PCT], ['viajes', 1, 50]],
    referidor: [['pct', 0, COMISION_PCT], ['viajes', 1, 50], ['diasUso', 1, 365]],
  }
  for (const grupo of ['invitado', 'referidor'] as const) {
    if (e[grupo] === undefined) continue
    if (!e[grupo] || typeof e[grupo] !== 'object' || Array.isArray(e[grupo])) {
      return { error: `${grupo} debe ser un objeto` }
    }
    const g = e[grupo] as Record<string, unknown>
    for (const [k, min, max] of rangosAnidados[grupo]) {
      if (g[k] === undefined) continue
      const r = numero(`${grupo}.${k}`, g[k], min, max)
      if (typeof r === 'string') return { error: r }
      ;(cfg[grupo] as Record<string, number>)[k] = r
    }
  }
  return { valor: cfg }
}

/** Código de invitación que no existe (422 en el registro). */
export class CodigoReferidoInvalido extends Error {
  code = 'CODIGO_INVALIDO'
  constructor() {
    super('El código de invitación no existe. Revísalo o déjalo vacío.')
  }
}

const inicioMes = () => DateTime.now().startOf('month').toSQL()!

export default class ReferidosService {
  /** Código único para un conductor nuevo (nombre + 3 dígitos de la placa). */
  static async codigoNuevo(nombre: string, placa: string, trx?: TransactionClientContract): Promise<string> {
    const base = baseCodigo(nombre, placa)
    const existentes = await Conductor.query({ client: trx })
      .where('codigo_referido', 'like', `${base}%`)
      .select('codigo_referido')
    return codigoLibre(base, new Set(existentes.map((c) => c.codigoReferido!)))
  }

  /**
   * Registro: enlaza al invitado con el dueño del código. Programa apagado o sin
   * código → no hace nada. Código inexistente → CodigoReferidoInvalido.
   */
  static async registrarInvitacion(
    trx: TransactionClientContract,
    invitado: Conductor,
    codigo?: string | null
  ): Promise<void> {
    const limpio = (codigo || '').trim().toUpperCase()
    if (!limpio) return
    const cfg = await referidosConfig(trx)
    if (!cfg.activo) return
    const referidor = await Conductor.query({ client: trx }).where('codigo_referido', limpio).first()
    if (!referidor || referidor.id === invitado.id) throw new CodigoReferidoInvalido()
    await Referido.create(
      { referidorConductorId: referidor.id, invitadoConductorId: invitado.id, estado: 'pendiente' },
      { client: trx }
    )
  }

  /** Aprobación del invitado: arranca el plazo de la meta y crea su cupón. Idempotente. */
  static async alAprobar(conductorId: number): Promise<void> {
    const referido = await Referido.query()
      .where('invitado_conductor_id', conductorId)
      .where('estado', 'pendiente')
      .whereNull('vence_en')
      .first()
    if (!referido) return
    const cfg = await referidosConfig()
    const ahora = DateTime.now()
    referido.aprobadoEn = ahora
    referido.venceEn = ahora.plus({ days: cfg.diasMeta })
    await referido.save()
    await CuponComision.create({
      conductorId,
      referidoId: referido.id,
      tipo: 'invitado',
      pct: cfg.invitado.pct,
      usosRestantes: cfg.invitado.viajes,
      venceEn: referido.venceEn,
      estado: 'activo',
    })
  }

  /** Cupones usables hoy (activos, con usos y sin vencer), el más viejo primero. */
  private static async cuponesVigentes(conductorId: number, trx?: TransactionClientContract) {
    const cupones = await CuponComision.query({ client: trx })
      .where('conductor_id', conductorId)
      .where('estado', 'activo')
      .where('usos_restantes', '>', 0)
      .orderBy('id', 'asc')
    return cupones.filter((c) => c.vigente)
  }

  /** Comisión que dejó de cobrarse este mes por cupones (la del 10 % menos la cobrada). */
  static async comisionNoCobradaMes(trx?: TransactionClientContract): Promise<number> {
    const filas = await Ganancia.query({ client: trx })
      .whereNotNull('cupon_id')
      .where('created_at', '>=', inicioMes())
      .select('monto_bruto', 'comision')
    const total = filas.reduce(
      (acc, g) => acc + ((g.montoBruto ?? 0) * COMISION_PCT) / 100 - (g.comision ?? 0),
      0
    )
    return Math.round(total)
  }

  /**
   * Cierre de viaje (dentro de la transacción financiera): si hay cupón vigente y el tope
   * mensual lo permite, gasta un uso y devuelve el % a cobrar. null = 10 % normal.
   */
  static async descuentoPara(
    trx: TransactionClientContract,
    conductorId: number,
    montoBruto: number
  ): Promise<{ pct: number; cuponId: number } | null> {
    const cfg = await referidosConfig(trx)
    if (!cfg.activo) return null
    const [cupon] = await this.cuponesVigentes(conductorId, trx)
    if (!cupon) return null
    const descuento = (montoBruto * (COMISION_PCT - cupon.pct)) / 100
    if ((await this.comisionNoCobradaMes(trx)) + descuento > cfg.topeMensualPesos) return null
    cupon.usosRestantes -= 1
    await cupon.useTransaction(trx).save()
    return { pct: cupon.pct, cuponId: cupon.id }
  }

  /** Viajes del invitado que cuentan para la meta (desde la aprobación, sin cierres fuera de destino). */
  private static async viajesDeMeta(referido: Referido, cfg: ReferidosConfig): Promise<number> {
    if (!referido.aprobadoEn) return 0
    const conductorId = referido.invitadoConductorId
    // La fecha se compara en JS: la base guarda los timestamps sin milisegundos y un
    // `where` con texto fallaba dentro del mismo segundo (SQLite en tests).
    const desde = referido.aprobadoEn.startOf('second')
    const viajes = await Viaje.query()
      .where('conductor_id', conductorId)
      .where('estado', 'finalizado')
      .select('id', 'cliente_id', 'finalizado_at')
    const fraudes = await LogFraude.query()
      .where('conductor_id', conductorId)
      .where('tipo', 'cierre_fuera_de_destino')
      .select('metadata')
    const excluidos = new Set(fraudes.map((f) => Number(f.metadata?.viajeId)))
    const validos = viajes.filter(
      (v) => !excluidos.has(v.id) && v.finalizadoAt !== null && v.finalizadoAt >= desde
    )
    return cfg.clientesDistintos ? new Set(validos.map((v) => v.clienteId)).size : validos.length
  }

  /** Estado real del referido: 'pendiente' vencido se lee como 'vencido' (sin cron). */
  static estadoActual(referido: Referido): string {
    if (referido.estado === 'pendiente' && referido.venceEn && referido.venceEn < DateTime.now()) {
      return 'vencido'
    }
    return referido.estado
  }

  /** Después del commit del cierre. Nunca rompe el cierre: todo error se registra. */
  static async alFinalizar(viaje: Viaje): Promise<void> {
    if (!viaje.conductorId) return
    try {
      const cfg = await referidosConfig()
      if (!cfg.activo) return
      const referido = await Referido.query()
        .where('invitado_conductor_id', viaje.conductorId)
        .where('estado', 'pendiente')
        .whereNotNull('vence_en')
        .first()
      if (!referido) return
      if (this.estadoActual(referido) === 'vencido') {
        referido.estado = 'vencido'
        await referido.save()
        return
      }
      if ((await this.viajesDeMeta(referido, cfg)) < cfg.viajesMeta) return

      const premiosMes = await Referido.query()
        .where('referidor_conductor_id', referido.referidorConductorId)
        .where('estado', 'activo')
        .where('activado_en', '>=', inicioMes())
        .count('* as total')
      if (Number(premiosMes[0].$extras.total) >= cfg.maxPremiosConductorMes) return

      referido.estado = 'activo'
      referido.activadoEn = DateTime.now()
      await referido.save()
      await CuponComision.create({
        conductorId: referido.referidorConductorId,
        referidoId: referido.id,
        tipo: 'referidor',
        pct: cfg.referidor.pct,
        usosRestantes: cfg.referidor.viajes,
        venceEn: DateTime.now().plus({ days: cfg.referidor.diasUso }),
        estado: 'activo',
      })

      const [referidor, invitado] = await Promise.all([
        Conductor.query().where('id', referido.referidorConductorId).preload('usuario').first(),
        Conductor.query().where('id', referido.invitadoConductorId).preload('usuario').first(),
      ])
      const nombreInvitado = invitado?.usuario?.nombre || 'Tu invitado'
      const premio = cfg.referidor.pct === 0 ? 'sin comisión' : `con ${cfg.referidor.pct} % de comisión`
      if (referidor?.usuario) {
        await this.notificar(
          referidor.usuario,
          '¡Tu invitado cumplió la meta!',
          `${nombreInvitado} ya hizo sus ${cfg.viajesMeta} viajes: tus próximos ${cfg.referidor.viajes} viajes son ${premio}.`
        )
      }
      if (invitado?.usuario) {
        await this.notificar(
          invitado.usuario,
          '¡Meta cumplida!',
          `Cumpliste tus ${cfg.viajesMeta} viajes y tu colega ya recibió su premio. Gracias por unirte.`
        )
      }
    } catch (err) {
      logger.error({ err, viajeId: viaje.id }, 'ReferidosService.alFinalizar')
    }
  }

  private static async notificar(user: User, titulo: string, mensaje: string) {
    await Notificacion.create({ usuarioId: user.id, tipo: 'referido_activado', titulo, mensaje, leido: false })
    if (user.fcmToken) {
      try {
        await sendToToken(user.fcmToken, titulo, mensaje)
      } catch (err) {
        logger.warn({ err, userId: user.id }, 'Push de referidos no enviado')
      }
    }
  }

  private static cuponJson(c: CuponComision) {
    return { tipo: c.tipo, pct: c.pct, usosRestantes: c.usosRestantes, venceEn: c.venceEn?.toISO() ?? null }
  }

  /** GET /api/drivers/referidos. */
  static async resumenConductor(conductor: Conductor) {
    const cfg = await referidosConfig()
    if (!conductor.codigoReferido) {
      await conductor.load('usuario')
      conductor.codigoReferido = await this.codigoNuevo(
        conductor.usuario.nombre ?? '',
        conductor.placa ?? ''
      )
      await conductor.save()
    }
    const invitados = await Referido.query()
      .where('referidor_conductor_id', conductor.id)
      .preload('invitado', (q) => q.preload('usuario', (u) => u.select('id', 'nombre', 'apellido')))
      .orderBy('id', 'desc')
    const propio = await Referido.query().where('invitado_conductor_id', conductor.id).first()
    const nombreDe = (c: Conductor) => `${c.usuario?.nombre || ''} ${c.usuario?.apellido || ''}`.trim()
    return {
      programaActivo: cfg.activo,
      codigo: conductor.codigoReferido,
      reglas: {
        viajesMeta: cfg.viajesMeta,
        diasMeta: cfg.diasMeta,
        clientesDistintos: cfg.clientesDistintos,
        invitado: cfg.invitado,
        referidor: cfg.referidor,
      },
      invitados: await Promise.all(
        invitados.map(async (r) => ({
          nombre: nombreDe(r.invitado),
          viajes: Math.min(await this.viajesDeMeta(r, cfg), cfg.viajesMeta),
          meta: cfg.viajesMeta,
          estado: this.estadoActual(r),
          venceEn: r.venceEn?.toISO() ?? null,
        }))
      ),
      cupones: (await this.cuponesVigentes(conductor.id)).map(this.cuponJson),
      miProgreso:
        propio && this.estadoActual(propio) === 'pendiente'
          ? {
              viajes: Math.min(await this.viajesDeMeta(propio, cfg), cfg.viajesMeta),
              meta: cfg.viajesMeta,
              venceEn: propio.venceEn?.toISO() ?? null,
            }
          : null,
    }
  }

  /** GET /api/admin/referidos. */
  static async resumenAdmin() {
    const cfg = await referidosConfig()
    const referidos = await Referido.query()
      .preload('referidor', (q) => q.preload('usuario', (u) => u.select('id', 'nombre', 'apellido')))
      .preload('invitado', (q) => q.preload('usuario', (u) => u.select('id', 'nombre', 'apellido')))
      .orderBy('id', 'desc')
    const cupones = await CuponComision.query().whereIn('referido_id', referidos.map((r) => r.id)).orderBy('id')
    const nombreDe = (c: Conductor) => `${c.usuario?.nombre || ''} ${c.usuario?.apellido || ''}`.trim()
    return {
      referidos: await Promise.all(
        referidos.map(async (r) => ({
          id: r.id,
          referidor: { id: r.referidorConductorId, nombre: nombreDe(r.referidor), codigo: r.referidor.codigoReferido },
          invitado: { id: r.invitadoConductorId, nombre: nombreDe(r.invitado) },
          estado: this.estadoActual(r),
          viajes: Math.min(await this.viajesDeMeta(r, cfg), cfg.viajesMeta),
          meta: cfg.viajesMeta,
          venceEn: r.venceEn?.toISO() ?? null,
          creadoEn: r.createdAt?.toISO() ?? null,
          cupones: cupones.filter((c) => c.referidoId === r.id).map((c) => ({ ...this.cuponJson(c), estado: c.estado })),
        }))
      ),
      comisionNoCobradaMes: await this.comisionNoCobradaMes(),
      topeMensualPesos: cfg.topeMensualPesos,
    }
  }

  /** PUT /api/admin/referidos/:id/anular: el referido y sus cupones dejan de valer. */
  static async anular(id: number): Promise<Referido | null> {
    const referido = await Referido.find(id)
    if (!referido) return null
    referido.estado = 'anulado'
    await referido.save()
    await CuponComision.query().where('referido_id', id).update({ estado: 'anulado' })
    return referido
  }
}
