import Conductor from '#models/conductor'
import LogFraude from '#models/log_fraude'
import { DateTime } from 'luxon'
import antifraudeConfig from '#config/antifraude'
import { distanciaKm } from '#services/geo_service'
import { emitToAdmin } from '#start/socket'
import logger from '@adonisjs/core/services/logger'

export class AntifraudeError extends Error {
  constructor(
    public code: string,
    public message: string,
    public statusCode: number = 422,
    public extra?: Record<string, any>
  ) {
    super(message)
    this.name = 'AntifraudeError'
  }
}

export class AntifraudeService {
  /**
   * Obtiene la ubicación reciente del conductor desde el modelo Conductor.
   * Lanza AntifraudeError UBICACION_NO_RECIENTE si no hay ubicación o es vieja (> ubicacionMaxSeg).
   */
  static obtenerUbicacionReciente(conductor: Conductor): { lat: number; lng: number } {
    if (conductor.ultimaUbicacionLat == null || conductor.ultimaUbicacionLng == null) {
      throw new AntifraudeError(
        'UBICACION_NO_RECIENTE',
        'No tienes ubicación registrada. Actualiza tu ubicación antes de continuar.',
        422
      )
    }

    if (conductor.ubicacionActualizadaEn == null) {
      throw new AntifraudeError(
        'UBICACION_NO_RECIENTE',
        'Tu ubicación no es reciente. Actualízala antes de continuar.',
        422
      )
    }

    const ubicacionAgeSeg = DateTime.now().diff(conductor.ubicacionActualizadaEn, 'seconds').seconds
    if (ubicacionAgeSeg > antifraudeConfig.ubicacionMaxSeg) {
      throw new AntifraudeError(
        'UBICACION_NO_RECIENTE',
        'Tu ubicación no es reciente. Actualízala antes de continuar.',
        422
      )
    }

    return {
      lat: conductor.ultimaUbicacionLat,
      lng: conductor.ultimaUbicacionLng,
    }
  }

  /**
   * Calcula la distancia en km entre la ubicación del conductor y un punto destino.
   */
  static distanciaA(conductor: Conductor, lat: number, lng: number): number {
    const ubicacion = this.obtenerUbicacionReciente(conductor)
    return distanciaKm(ubicacion.lat, ubicacion.lng, lat, lng)
  }

  /**
   * Valida que la justificación tenga al menos 10 caracteres.
   * Lanza AntifraudeError JUSTIFICACION_REQUERIDA si no cumple.
   */
  static validarJustificacion(justificacion?: string): void {
    if (!justificacion || justificacion.trim().length < 10) {
      throw new AntifraudeError(
        'JUSTIFICACION_REQUERIDA',
        'La justificación debe tener al menos 10 caracteres.',
        422
      )
    }
  }

  /**
   * Registra un intento de fraude en logs_fraude y emite evento admin:fraud_alert.
   * Todo en try/catch para no bloquear el flujo principal.
   */
  static async registrarFraude(
    tipo: string,
    data: {
      userId: number
      conductorId: number
      viajeId: number
      distanciaKm?: number
      justificacion?: string
      descripcion?: string
      latitud?: number
      longitud?: number
      metadata?: Record<string, any>
    }
  ): Promise<void> {
    try {
      await LogFraude.create({
        userId: data.userId,
        conductorId: data.conductorId,
        tipo,
        descripcion: data.descripcion ?? `${tipo} - viaje ${data.viajeId}`,
        latitud: data.latitud ?? null,
        longitud: data.longitud ?? null,
        metadata: {
          viajeId: data.viajeId,
          distanciaKm: data.distanciaKm,
          justificacion: data.justificacion,
          ...data.metadata,
        },
      })

      emitToAdmin('admin:fraud_alert', {
        tipo,
        viajeId: data.viajeId,
        conductorId: data.conductorId,
        distanciaKm: data.distanciaKm,
        justificacion: data.justificacion,
      })
    } catch (e) {
      logger.error({ err: e, tipo, data }, 'Error registrando fraude en AntifraudeService')
    }
  }

  /**
   * R1: Cliente cancela con conductor cerca del origen (< radioCierreKm).
   * Lanza AntifraudeError CONDUCTOR_CERCA si el conductor está a menos del radio.
   */
  static async validarCancelacionClienteCercaOrigen(
    viaje: { origenLat: number; origenLng: number; conductorId: number | null },
    conductor: Conductor | null
  ): Promise<void> {
    if (!conductor) return

    const distKm = this.distanciaA(conductor, viaje.origenLat, viaje.origenLng)
    if (distKm < antifraudeConfig.radioCierreKm) {
      throw new AntifraudeError(
        'CONDUCTOR_CERCA',
        `No puedes cancelar: el conductor está a ${distKm.toFixed(2)} km del origen (mín. ${antifraudeConfig.radioCierreKm} km)`,
        422,
        { distanciaKm: distKm }
      )
    }
  }

  /**
   * R2: Validar recogida - conductor debe estar a menos de radioRecogidaKm del origen.
   * Lanza AntifraudeError FUERA_DE_RANGO_ORIGEN si no cumple.
   */
  static async validarRecogida(
    viaje: { origenLat: number; origenLng: number; id: number },
    conductor: Conductor
  ): Promise<{ distanciaKm: number }> {
    const distKm = this.distanciaA(conductor, viaje.origenLat, viaje.origenLng)
    if (distKm >= antifraudeConfig.radioRecogidaKm) {
      await this.registrarFraude('recogida_fuera_de_origen', {
        userId: conductor.usuarioId,
        conductorId: conductor.id,
        viajeId: viaje.id,
        distanciaKm: distKm,
        descripcion: `Intento de marcar recogida a ${distKm.toFixed(2)} km del origen`,
        latitud: conductor.ultimaUbicacionLat!,
        longitud: conductor.ultimaUbicacionLng!,
      })
      throw new AntifraudeError(
        'FUERA_DE_RANGO_ORIGEN',
        `No puedes marcar la recogida: estás a ${distKm.toFixed(2)} km del punto de origen.`,
        422,
        { distanciaKm: distKm }
      )
    }
    return { distanciaKm: distKm }
  }

  /**
   * R3: Validar cierre de servicio (complete/finalize).
   * - Si < 1 km: OK (pasa a pendiente_confirmacion)
   * - Si >= 1 km: exige justificación, registra fraude si la hay, pasa a pendiente_confirmacion
   * Lanza AntifraudeError JUSTIFICACION_REQUERIDA si fuera de rango y sin justificación.
   * Retorna { distanciaKm, fueraDeRango, justificacion }
   */
  static async validarCierreServicio(
    viaje: { destinoLat: number; destinoLng: number; id: number },
    conductor: Conductor,
    justificacion?: string
  ): Promise<{ distanciaKm: number; fueraDeRango: boolean; justificacion?: string }> {
    const distKm = this.distanciaA(conductor, viaje.destinoLat, viaje.destinoLng)
    const fueraDeRango = distKm >= antifraudeConfig.radioCierreKm

    if (fueraDeRango) {
      this.validarJustificacion(justificacion)
      await this.registrarFraude('cierre_fuera_de_destino', {
        userId: conductor.usuarioId,
        conductorId: conductor.id,
        viajeId: viaje.id,
        distanciaKm: distKm,
        justificacion,
        descripcion: `Cierre fuera de rango (${distKm.toFixed(2)} km). Justificación: ${justificacion}`,
        latitud: conductor.ultimaUbicacionLat!,
        longitud: conductor.ultimaUbicacionLng!,
      })
    }

    return { distanciaKm: distKm, fueraDeRango, justificacion }
  }

  /**
   * R1: Conductor cancela - exige justificación obligatoria (mín 10 chars).
   * Retorna la justificación validada.
   */
  static async validarCancelacionConductor(justificacion?: string): Promise<string> {
    this.validarJustificacion(justificacion)
    return justificacion!.trim()
  }
}

export default AntifraudeService