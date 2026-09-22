import vine from '@vinejs/vine'

/**
 * Shared rules for email and password.
 */
const email = () => vine.string().email().maxLength(254)
const password = () => vine.string().minLength(8).maxLength(32)

/**
 * Validator to use when performing self-signup
 */
export const signupValidator = vine.create({
  fullName: vine.string().nullable(),
  email: email().unique({ table: 'users', column: 'email' }),
  password: password(),
  passwordConfirmation: password().sameAs('password'),
})

/**
 * Validator to use before validating user credentials
 * during login
 */
export const loginValidator = vine.create({
  email: email(),
  password: vine.string(),
})

/**
 * PUT /api/admin/users/:id — edición de datos básicos desde el panel.
 *
 * Antes se leía el body con `request.only()` sin validar nada: se podía guardar
 * un email con cualquier formato o una edad de 999. Todos los campos son
 * opcionales (se edita solo lo que llega); `telefono` y `edad` aceptan null para
 * poder borrar el dato.
 */
export const adminUpdateUserValidator = vine.create({
  nombre: vine.string().trim().minLength(1).maxLength(100).optional(),
  apellido: vine.string().trim().minLength(1).maxLength(100).optional(),
  email: email().optional(),
  telefono: vine.string().trim().maxLength(20).nullable().optional(),
  edad: vine.number().min(18).max(120).nullable().optional(),
})
