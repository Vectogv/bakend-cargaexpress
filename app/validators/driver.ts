import vine from '@vinejs/vine'

export const driverStatusValidator = vine.create({
  online: vine.boolean(),
})

export const driverLocationValidator = vine.create({
  lat: vine.number().min(-90).max(90),
  lng: vine.number().min(-180).max(180),
})

/** Cuerpo opcional de POST /api/moderator/drivers/:id/notify: documentos que faltan + nota. */
export const notifyDriverValidator = vine.create({
  documentos: vine
    .array(vine.enum(['licencia', 'soat', 'tecnomecanica', 'tarjeta_propiedad', 'foto_vehiculo', 'foto_conductor', 'numero_cedula']))
    .minLength(1)
    .optional(),
  mensaje: vine.string().trim().maxLength(500).optional(),
})
