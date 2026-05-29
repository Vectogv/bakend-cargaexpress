import vine from '@vinejs/vine'

export const updateProfileValidator = vine.create({
  nombre: vine.string().maxLength(100).optional(),
  apellido: vine.string().maxLength(100).optional(),
  email: vine.string().email().maxLength(254).optional(),
  telefono: vine.string().maxLength(20).nullable().optional(),
  edad: vine.number().min(18).max(120).nullable().optional(),
})
