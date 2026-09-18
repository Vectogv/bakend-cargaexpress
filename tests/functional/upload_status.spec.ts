import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import User from '#models/user'

test.group('Upload Status - No File', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  async function registerAndGetToken(client: any, rol: string = 'cliente') {
    const email = `upload-${rol}-${Date.now()}@test.com`
    const res = await client.post('/api/auth/register').json({
      nombre: 'Test',
      apellido: 'User',
      email,
      password: '123456',
      rol,
      ...(rol === 'conductor'
        ? { cedula: '12345678', placa: `UPL-${Date.now()}`, tipoVehiculo: 'camioneta', capacidad: '1000 kg' }
        : {}),
    })
    return { token: res.body().token, email }
  }

  test('POST /api/payment/proof returns 400 when no file uploaded', async ({ client }) => {
    const { token, email } = await registerAndGetToken(client, 'cliente')

    // Set user estadoCuenta to suspension_por_pago to pass the validation
    const testUser = await User.findBy('email', email)
    testUser!.estadoCuenta = 'suspension_por_pago'
    await testUser!.save()

    const response = await client
      .post('/api/payment/proof')
      .bearerToken(token)

    response.assertStatus(400)
    response.assertBodyContains({ error: 'No file uploaded' })
  })

  test('POST /api/users/avatar returns 400 when no file uploaded', async ({ client }) => {
    const { token } = await registerAndGetToken(client, 'cliente')

    const response = await client
      .post('/api/users/avatar')
      .bearerToken(token)

    response.assertStatus(400)
    response.assertBodyContains({ error: 'No file uploaded' })
  })
})