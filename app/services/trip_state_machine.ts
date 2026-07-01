import { TRIP_STATUS } from '../../contracts/trip_status.js'

export type EstadoViaje = (typeof TRIP_STATUS)[keyof typeof TRIP_STATUS]

const transiciones: Record<EstadoViaje, EstadoViaje[]> = {
  creado: ['buscando_conductor', 'cancelado'],
  buscando_conductor: ['pendiente', 'aceptado', 'cancelado', 'rechazado'],
  pendiente: ['aceptado', 'cancelado', 'rechazado'],
  aceptado: ['conductor_en_camino', 'en_curso', 'cancelado', 'sos'],
  conductor_en_camino: ['conductor_llegada', 'cancelado', 'sos'],
  conductor_llegada: ['en_curso', 'cancelado', 'sos'],
  en_curso: ['entregado', 'cancelado', 'sos'],
  entregado: ['esperando_confirmacion', 'disputa'],
  esperando_confirmacion: ['finalizado', 'disputa'],
  finalizado: [],
  cancelado: [],
  rechazado: [],
  sos: ['conductor_en_camino', 'conductor_llegada', 'en_curso', 'finalizado', 'cancelado'],
  disputa: ['finalizado'],
}

export default class TripStateMachine {
  static validarTransicion(actual: EstadoViaje, siguiente: EstadoViaje): boolean {
    return transiciones[actual]?.includes(siguiente) ?? false
  }
}
