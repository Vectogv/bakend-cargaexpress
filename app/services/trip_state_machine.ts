export type EstadoViaje =
  | 'buscando_conductor'
  | 'pendiente'
  | 'aceptado'
  | 'en_curso'
  | 'completado'
  | 'finalizado'
  | 'cancelado'
  | 'rechazado'

const transiciones: Record<EstadoViaje, EstadoViaje[]> = {
  buscando_conductor: ['pendiente', 'aceptado', 'cancelado', 'rechazado'],
  pendiente: ['aceptado', 'cancelado', 'rechazado'],
  aceptado: ['en_curso', 'cancelado'],
  en_curso: ['completado', 'cancelado'],
  completado: ['finalizado'],
  finalizado: [],
  cancelado: [],
  rechazado: [],
}

export default class TripStateMachine {
  static validarTransicion(actual: EstadoViaje, siguiente: EstadoViaje): boolean {
    return transiciones[actual]?.includes(siguiente) ?? false
  }
}
