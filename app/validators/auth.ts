import vine, { SimpleMessagesProvider } from '@vinejs/vine'

const email = () => vine.string().email().maxLength(254)
const password = () => vine.string().minLength(6).maxLength(32)

export const registerValidator = vine.create({
  nombre: vine.string().maxLength(100),
  apellido: vine.string().maxLength(100),
  email: email().unique({ table: 'users', column: 'email' }),
  password: password(),
  telefono: vine.string().maxLength(20).nullable().optional(),
  rol: vine.enum(['conductor', 'cliente']),
  // H3: La edad es obligatoria y debe ser mayor de 18 años.
  edad: vine.number().min(18).max(120),
  cedula: vine.string().maxLength(20).nullable().optional(),
  placa: vine.string().maxLength(20).nullable().optional(),
  tipoVehiculo: vine.string().maxLength(50).nullable().optional(),
  capacidad: vine.string().maxLength(50).nullable().optional(),
  ciudad: vine.string().maxLength(100).nullable().optional(),
})

// Mensajes en español para la regla requerida de la edad (H3).
export const registerValidatorMessages = new SimpleMessagesProvider({
  'edad.required': 'La edad es obligatoria',
})

export const loginValidator = vine.create({
  email: email(),
  password: vine.string(),
})

export const refreshTokenValidator = vine.create({
  refreshToken: vine.string().minLength(1),
})
