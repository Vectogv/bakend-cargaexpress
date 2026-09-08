import vine from '@vinejs/vine'

export const updateSettingsValidator = vine.create({
  idioma: vine.string().maxLength(10).in(['es', 'en']).optional(),
  notificacionesSonido: vine.boolean().optional(),
  visibilidad: vine.string().maxLength(20).in(['visible', 'oculto', 'solo_conductores']).optional(),
})
