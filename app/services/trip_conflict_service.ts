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
 * Estados en los que el conductor está atendiendo un servicio (asignado y aún
 * no lo ha cerrado). `pendiente_confirmacion` y `disputa` no cuentan: el
 * conductor ya entregó la carga y puede tomar otro servicio.
 */
export const ESTADOS_CONDUCTOR_OCUPADO = [
  'aceptado',
  'conductor_en_camino',
  'conductor_llegada',
  'en_curso',
  'sos',
]

/**
 * Orden determinista para elegir "el" viaje en curso del conductor: la fase
 * más avanzada primero y, a igualdad, el más reciente.
 */
export const ORDEN_CONDUCTOR_OCUPADO_SQL = `CASE estado
  WHEN 'sos' THEN 0
  WHEN 'en_curso' THEN 1
  WHEN 'conductor_llegada' THEN 2
  WHEN 'conductor_en_camino' THEN 3
  WHEN 'aceptado' THEN 4
  ELSE 5
END ASC, id DESC`

/**
 * Validación de disponibilidad de un conductor.
 *
 * Reglas:
 *  • Reserva programada: no puede quedar asignado si ya tiene otro viaje
 *    comprometido cuya hora efectiva cae dentro de la ventana de conflicto.
 *  • Viaje inmediato: no puede quedar asignado si ya está atendiendo otro
 *    servicio (un conductor = un servicio a la vez).
 */
export default class TripConflictService {
  static async conductorTieneConflicto(
    conductorId: number,
    viaje: Viaje,
    client?: any
  ): Promise<boolean> {
    if (viaje.tipoProgramacion !== 'programada') {
      return this.conductorOcupado(conductorId, viaje.id, client)
    }

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

  /**
   * Indica si el conductor está atendiendo otro servicio en este momento.
   *
   * Una reserva programada ya asignada pero aún en `aceptado` solo lo ocupa
   * si su hora está dentro de la ventana de conflicto (una reserva de mañana
   * no le impide tomar un viaje inmediato hoy).
   */
  static async conductorOcupado(
    conductorId: number,
    excluirViajeId?: number | null,
    client?: any
  ): Promise<boolean> {
    // `reservado` con conductor = reserva asignada sin activar: ocupa solo si
    // su hora cae dentro de la ventana (igual que una reserva ya aceptada).
    const query = Viaje.query(client ? { client } : {})
      .where('conductor_id', conductorId)
      .whereIn('estado', [...ESTADOS_CONDUCTOR_OCUPADO, 'reservado'])
    if (excluirViajeId) query.whereNot('id', excluirViajeId)

    const otros = await query
    const now = DateTime.now()

    for (const otro of otros) {
      const reservaFutura =
        otro.tipoProgramacion === 'programada' && ['aceptado', 'reservado'].includes(otro.estado)
      if (!reservaFutura) return true
      const hora = effectiveTripTime(otro, now)
      if (!hora || timesConflict(hora, now)) return true
    }

    return false
  }
}
