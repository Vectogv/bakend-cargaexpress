import { TRIP_STATUS } from '../../contracts/trip_status.js'
import type { TripStatus } from '../../contracts/trip_status.js'

export const TRIP_STATUS_LABELS: Record<string, string> = {
  [TRIP_STATUS.CREADO]: 'Solicitud creada',
  [TRIP_STATUS.RESERVADO]: 'Reserva confirmada (programada)',
  [TRIP_STATUS.BUSCANDO]: 'Buscando conductor',
  [TRIP_STATUS.PENDIENTE]: 'Conductor ofertó (pendiente de aceptación)',
  [TRIP_STATUS.ACEPTADO]: 'Viaje aceptado. Conductor asignado',
  [TRIP_STATUS.EN_CAMINO]: 'Conductor en camino al origen',
  [TRIP_STATUS.LLEGADA]: 'Conductor llegó al punto de recogida',
  [TRIP_STATUS.EN_CURSO]: 'Carga recogida, en ruta al destino',
  [TRIP_STATUS.ENTREGADO]: 'Carga entregada al cliente',
  [TRIP_STATUS.ESPERA_CONFIRMACION]: 'Esperando confirmación del cliente',
  [TRIP_STATUS.FINALIZADO]: 'Viaje finalizado',
  [TRIP_STATUS.CANCELADO]: 'Viaje cancelado',
  [TRIP_STATUS.RECHAZADO]: 'Viaje rechazado',
  [TRIP_STATUS.DISPUTA]: 'Disputa abierta',
  [TRIP_STATUS.SOS]: 'BOTÓN DE PÁNICO — Atender con urgencia',
}

export function getTripEstadoLabel(estado: string | null | undefined): string {
  if (!estado) return 'Desconocido'
  return TRIP_STATUS_LABELS[estado as TripStatus] ?? estado
}