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
  // Quién recibe la carga en el destino (opcional): el conductor lo ve para
  // coordinar la entrega.
  receptorNombre: vine.string().trim().maxLength(120).nullable().optional(),
  receptorTelefono: vine.string().trim().maxLength(30).nullable().optional(),
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
  receptorNombre: vine.string().trim().maxLength(120).nullable().optional(),
  receptorTelefono: vine.string().trim().maxLength(30).nullable().optional(),
  // Fecha/hora programada. Se validan además contra la anticipación mínima
  // en el controlador (depende de la configuración de la plataforma).
  fechaProgramada: vine.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  horaProgramada: vine.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
})

// `montoFinal` es opcional e ignorado si el viaje ya tiene precio acordado
// (trip_controller.complete): se acepta para no romper apps anteriores.
export const tripCompleteValidator = vine.create({
  montoFinal: vine.number().min(0).optional(),
  // PIN de entrega: obligatorio al cerrar cerca del destino (se valida en el
  // controlador contra viaje.pinEntrega). Con justificación (lejos) no aplica.
  pin: vine.string().trim().regex(/^\d{4}$/).optional(),
})

export const tripCancelValidator = vine.create({
  motivo: vine.string().nullable().optional(),
})
