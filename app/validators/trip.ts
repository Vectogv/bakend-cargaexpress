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
})

export const tripCompleteValidator = vine.create({
  montoFinal: vine.number().min(0),
})

export const tripCancelValidator = vine.create({
  motivo: vine.string().nullable().optional(),
})
