import vine from '@vinejs/vine'

export const updateSettingsValidator = vine.create({
  idioma: vine.string().maxLength(10).optional().in(['es', 'en']),
  notificacionesSonido: vine.boolean().optional(),
  visibilidad: vine.string().maxLength(20).optional().in(['visible', 'oculto', 'solo_conductores']),
})
