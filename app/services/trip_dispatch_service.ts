import Conductor from '#models/conductor'
import Viaje from '#models/viaje'
import GeoService from '#services/geo_service'
import { ESTADOS_CONDUCTOR_OCUPADO } from '#services/trip_conflict_service'
import { emitToDriver } from '#start/socket'
import { sendToMultiple } from '#services/push_notification_service'

/**
 * Centraliza el "disparo" de un viaje a los conductores cercanos.
 *
 * Lo usan por igual:
 *   • POST /api/trips/request  (viaje inmediato)
 *   • scheduler de reservas    (viaje programado que se activa)
 *
 * Así no se duplica la lógica de búsqueda ni el contrato Socket.IO.
 */
export default class TripDispatchService {
  /** Emite `trip:nearby` + push a los conductores cercanos. Devuelve cuántos notificó. */
  static async buscarConductores(viaje: Viaje, radioKm = 20): Promise<number> {
    const cercanosRaw = await GeoService.obtenerConductoresCercanos(
      Number(viaje.origenLat),
      Number(viaje.origenLng),
      radioKm
    )

    const conductorIds = cercanosRaw.map((c: any) => c.id)
    if (conductorIds.length === 0) return 0

    const esProgramada = viaje.tipoProgramacion === 'programada'

    const query = Conductor.query().whereIn('id', conductorIds).preload('usuario')
    // Viaje inmediato: no se notifica a conductores que ya atienden un servicio
    // (no podrían ofertar: ver TripConflictService.conductorOcupado).
    if (!esProgramada) {
      query.whereNotIn(
        'id',
        Viaje.query()
          .select('conductor_id')
          .whereNotNull('conductor_id')
          .whereIn('estado', ESTADOS_CONDUCTOR_OCUPADO)
          .where((q) => q.whereNot('tipo_programacion', 'programada').orWhereNot('estado', 'aceptado'))
      )
    }
    const conductoresCercanos = await query
    if (conductoresCercanos.length === 0) return 0

    // F deduplica las notificaciones con `_id ?? id`: siempre enviamos ambas
    // como String, además de `tripId`, para que jamás se cuelgue con "null".
    const tripSocketPayload = {
      event: 'trip:nearby',
      tripId: String(viaje.id),
      id: String(viaje.id),
      _id: String(viaje.id),
      viajeId: String(viaje.id),
      origen: viaje.origenDireccion,
      precioEstimado: Number(viaje.precioEstimado),
      type: 'new_trip',
      tipoProgramacion: viaje.tipoProgramacion ?? 'inmediata',
      ...(esProgramada
        ? {
            fechaProgramada: viaje.fechaProgramada,
            horaProgramada: viaje.horaProgramada,
          }
        : {}),
    }

    const tripFcmData: Record<string, string> = {
      type: 'new_trip',
      event: 'trip:nearby',
      tripId: String(viaje.id),
      origen: viaje.origenDireccion,
      tipoProgramacion: viaje.tipoProgramacion ?? 'inmediata',
      ...(esProgramada
        ? {
            fechaProgramada: viaje.fechaProgramada ?? '',
            horaProgramada: viaje.horaProgramada ?? '',
          }
        : {}),
    }

    for (const c of conductoresCercanos) {
      emitToDriver(c.usuarioId, 'trip:nearby', tripSocketPayload)
    }

    const tokens = conductoresCercanos.map((c) => c.usuario.fcmToken).filter(Boolean) as string[]
    if (tokens.length > 0) {
      const precioFormateado = Number(viaje.precioEstimado).toLocaleString('es-CO')
      await sendToMultiple(
        tokens,
        esProgramada ? 'Reserva programada disponible' : 'Nuevo viaje disponible',
        esProgramada
          ? `${viaje.fechaProgramada ?? ''} ${viaje.horaProgramada ?? ''} — ${viaje.origenDireccion} — $${precioFormateado}`
          : `Cerca de tu ubicación — $${precioFormateado}`,
        tripFcmData,
        'default'
      )
    }

    return conductoresCercanos.length
  }
}
