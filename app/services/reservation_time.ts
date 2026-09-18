import { DateTime } from 'luxon'
import reservationConfig from '#config/reservations'
import type Viaje from '#models/viaje'

/**
 * Convierte fecha (YYYY-MM-DD) + hora (HH:mm) en un DateTime con la zona
 * horaria de operación. Devuelve null si la combinación es inválida.
 */
export function parseScheduledDateTime(
  fecha: string | null | undefined,
  hora: string | null | undefined,
  zone: string = reservationConfig.timezone
): DateTime | null {
  if (!fecha || !hora) return null
  const dt = DateTime.fromISO(`${fecha}T${hora}`, { zone })
  return dt.isValid ? dt : null
}

/**
 * Momento "efectivo" de un viaje para comparaciones de horario:
 * las reservas usan su fecha/hora programada; los viajes inmediatos, "ahora".
 */
export function effectiveTripTime(viaje: Viaje, now: DateTime = DateTime.now()): DateTime | null {
  if (viaje.tipoProgramacion === 'programada') {
    return parseScheduledDateTime(viaje.fechaProgramada, viaje.horaProgramada)
  }
  return now
}

/**
 * Indica si dos momentos caen dentro de la ventana de conflicto configurada.
 */
export function timesConflict(a: DateTime, b: DateTime): boolean {
  const diffMinutes = Math.abs(a.diff(b, 'minutes').minutes)
  return diffMinutes < reservationConfig.scheduleConflictWindowMinutes
}
