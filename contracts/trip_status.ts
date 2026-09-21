export const TRIP_STATUS = {
  CREADO: 'creado',
  RESERVADO: 'reservado',
  BUSCANDO: 'buscando_conductor',
  PENDIENTE: 'pendiente',
  ACEPTADO: 'aceptado',
  EN_CAMINO: 'conductor_en_camino',
  LLEGADA: 'conductor_llegada',
  EN_CURSO: 'en_curso',
  ENTREGADO: 'entregado',
  ESPERA_CONFIRMACION: 'esperando_confirmacion',
  PENDIENTE_CONFIRMACION: 'pendiente_confirmacion',
  FINALIZADO: 'finalizado',
  CANCELADO: 'cancelado',
  RECHAZADO: 'rechazado',
  DISPUTA: 'disputa',
  SOS: 'sos',
} as const

export type TripStatus = (typeof TRIP_STATUS)[keyof typeof TRIP_STATUS]
