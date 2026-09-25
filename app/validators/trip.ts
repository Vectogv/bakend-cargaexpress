import vine from '@vinejs/vine'

export const tripRequestValidator = vine.create({
  origen: vine.object({
    direccion: vine.string(),
    lat: vine.number().min(-90).max(90),
    lng: vine.number().min(-180).max(180),
  }),
  destino: vine.object({
    direccion: vine.string(),
    lat: vine.number().min(-90).max(90),
    lng: vine.number().min(-180).max(180),
  }),
  descripcion: vine.string().nullable().optional(),
  precioCliente: vine.number().min(0),
})

export const tripReserveValidator = vine.create({
  origen: vine.object({
    direccion: vine.string(),
    lat: vine.number().min(-90).max(90),
    lng: vine.number().min(-180).max(180),
  }),
  destino: vine.object({
    direccion: vine.string(),
    lat: vine.number().min(-90).max(90),
    lng: vine.number().min(-180).max(180),
  }),
  descripcion: vine.string().nullable().optional(),
  precioCliente: vine.number().min(0),
  // Fecha/hora programada. Se validan además contra la anticipación mínima
  // en el controlador (depende de la configuración de la plataforma).
  fechaProgramada: vine.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  horaProgramada: vine.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
})

// `montoFinal` es opcional e ignorado si el viaje ya tiene precio acordado
// (trip_controller.complete): se acepta para no romper apps anteriores.
export const tripCompleteValidator = vine.create({
  montoFinal: vine.number().min(0).optional(),
})

export const tripCancelValidator = vine.create({
  motivo: vine.string().nullable().optional(),
})
