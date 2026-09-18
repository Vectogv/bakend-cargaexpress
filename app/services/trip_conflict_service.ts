import Viaje from '#models/viaje'
import { DateTime } from 'luxon'
import { effectiveTripTime, timesConflict } from '#services/reservation_time'

/** Estados en los que un conductor ya está comprometido con un viaje. */
const ESTADOS_COMPROMETIDOS = [
  'reservado',
  'buscando_conductor',
  'pendiente',
  'aceptado',
  'conductor_en_camino',
  'conductor_llegada',
  'en_curso',
]

/**
 * Validación básica (MVP) de compatibilidad de horarios de un conductor.
 *
 * Regla: un conductor no puede quedar asignado a un viaje programado si ya
 * tiene otro viaje comprometido cuya hora efectiva cae dentro de la ventana
 * de conflicto configurada.
 */
export default class TripConflictService {
  static async conductorTieneConflicto(
    conductorId: number,
    viaje: Viaje,
    client?: any
  ): Promise<boolean> {
    // Solo se valida para reservas programadas; el flujo inmediato queda intacto.
    if (viaje.tipoProgramacion !== 'programada') return false

    const objetivo = effectiveTripTime(viaje)
    if (!objetivo) return false

    const query = Viaje.query(client ? { client } : {})
      .where('conductor_id', conductorId)
      .whereNot('id', viaje.id)
      .whereIn('estado', ESTADOS_COMPROMETIDOS)

    const otros = await query
    const now = DateTime.now()

    for (const otro of otros) {
      const hora = effectiveTripTime(otro, now)
      if (!hora) continue
      if (timesConflict(hora, objetivo)) return true
    }

    return false
  }
}
