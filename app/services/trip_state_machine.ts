export type EstadoViaje =
  | 'creado'
  | 'buscando_conductor'
  | 'pendiente'
  | 'ofertas_recibidas'
  | 'aceptado'
  | 'conductor_aceptado'
  | 'conductor_en_camino'
  | 'conductor_llegada'
  | 'en_curso'
  | 'entregado'
  | 'esperando_confirmacion'
  | 'completado'
  | 'finalizado'
  | 'cancelado'
  | 'rechazado'
  | 'sos'
  | 'disputa'

const transiciones: Record<EstadoViaje, EstadoViaje[]> = {
  creado: ['buscando_conductor', 'cancelado'],
  buscando_conductor: ['pendiente', 'ofertas_recibidas', 'aceptado', 'cancelado', 'rechazado'],
  pendiente: ['ofertas_recibidas', 'aceptado', 'cancelado', 'rechazado'],
  ofertas_recibidas: ['aceptado', 'conductor_aceptado', 'cancelado'],
  aceptado: ['conductor_aceptado', 'conductor_en_camino', 'en_curso', 'cancelado', 'sos'],
  conductor_aceptado: ['conductor_en_camino', 'cancelado', 'sos'],
  conductor_en_camino: ['conductor_llegada', 'cancelado', 'sos'],
  conductor_llegada: ['en_curso', 'cancelado', 'sos'],
  en_curso: ['completado', 'entregado', 'cancelado', 'sos'],
  entregado: ['esperando_confirmacion', 'disputa'],
  esperando_confirmacion: ['completado', 'finalizado', 'disputa'],
  completado: ['finalizado', 'disputa'],
  finalizado: [],
  cancelado: [],
  rechazado: [],
  sos: ['conductor_en_camino', 'conductor_llegada', 'en_curso', 'completado', 'finalizado', 'cancelado'],
  disputa: ['completado', 'finalizado'],
}

export default class TripStateMachine {
  static validarTransicion(actual: EstadoViaje, siguiente: EstadoViaje): boolean {
    return transiciones[actual]?.includes(siguiente) ?? false
  }
}
