import vine from '@vinejs/vine'

// 7 a 15 dígitos, "+" opcional al inicio (E.164 laxo).
export const TELEFONO_REGEX = /^\+?\d{7,15}$/

export const updateProfileValidator = vine.create({
  nombre: vine.string().trim().minLength(1).maxLength(100).optional(),
  apellido: vine.string().trim().minLength(1).maxLength(100).optional(),
  // El email ya no se puede cambiar desde acá (profile_controller lo ignora);
  // se deja aceptado en el validador para no romper apps viejas que aún lo manden.
  email: vine.string().email().maxLength(254).optional(),
  // Obligatorio si se manda (sin nullable: null/"" falla), con formato.
  telefono: vine.string().trim().regex(TELEFONO_REGEX).optional(),
  edad: vine.number().min(18).max(120).nullable().optional(),
  cedula: vine.string().trim().maxLength(20).nullable().optional(),
  // Asistente de registro del cliente: `true` cierra el registro (registro_completo).
  aceptaTerminos: vine.boolean().optional(),
  contactoEmergenciaNombre: vine.string().maxLength(100).nullable().optional(),
  // Sigue opcional y se puede limpiar con null, pero si se manda un valor debe
  // tener formato de teléfono.
  contactoEmergenciaTelefono: vine.string().trim().regex(TELEFONO_REGEX).nullable().optional(),
})

export const changePasswordValidator = vine.create({
  actual: vine.string().minLength(1),
  nueva: vine.string().minLength(8).maxLength(72),
})
