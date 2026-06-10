import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'

test.group('Profile - Show', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  async function registerAndGetToken(client: any, rol: string = 'cliente') {
    const res = await client.post('/api/auth/register').json({
      nombre: 'Test',
      apellido: 'User',
      email: `test-${rol}-${Date.now()}@test.com`,
      password: '123456',
      rol,
      ...(rol === 'conductor'
        ? { cedula: '12345678', placa: `PRF-${Date.now()}`, tipoVehiculo: 'camioneta', capacidad: '1000 kg' }
        : {}),
    })
    return res.body().token
  }

  test('get profile as authenticated client user', async ({ client, assert }) => {
    const token = await registerAndGetToken(client, 'cliente')

    const response = await client.get('/api/users/profile').bearerToken(token)

    response.assertStatus(200)
    response.assertBodyContains({ nombre: 'Test', apellido: 'User', rol: 'cliente' })
    assert.isDefined(response.body().id)
    assert.isDefined(response.body().email)
    assert.isDefined(response.body().createdAt)
  })

  test('get profile as authenticated conductor user', async ({ client, assert }) => {
    const token = await registerAndGetToken(client, 'conductor')

    const response = await client.get('/api/users/profile').bearerToken(token)

    response.assertStatus(200)
    response.assertBodyContains({ nombre: 'Test', rol: 'conductor' })
    assert.isDefined(response.body().conductor)
    assert.isDefined(response.body().conductor.placa)
    assert.equal(response.body().conductor.tipoVehiculo, 'camioneta')
  })

  test('fail to get profile without authentication', async ({ client }) => {
    const response = await client.get('/api/users/profile')

    response.assertStatus(401)
  })

  test('fail to get profile with invalid token', async ({ client }) => {
    const response = await client.get('/api/users/profile').bearerToken('invalid-token')

    response.assertStatus(401)
  })
})

test.group('Profile - Update', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  async function registerAndGetToken(client: any) {
    const res = await client.post('/api/auth/register').json({
      nombre: 'Original',
      apellido: 'User',
      email: `update-${Date.now()}@test.com`,
      password: '123456',
      rol: 'cliente',
    })
    return res.body().token
  }

  test('update profile fields', async ({ client }) => {
    const token = await registerAndGetToken(client)

    const response = await client
      .put('/api/users/profile')
      .bearerToken(token)
      .json({ nombre: 'Updated', apellido: 'Name', telefono: '123456789', edad: 30 })

    response.assertStatus(200)
    response.assertBodyContains({ nombre: 'Updated', apellido: 'Name', telefono: '123456789', edad: 30 })
  })

  test('update email successfully', async ({ client }) => {
    const token = await registerAndGetToken(client)

    const response = await client
      .put('/api/users/profile')
      .bearerToken(token)
      .json({ email: 'newemail@test.com' })

    response.assertStatus(200)
    response.assertBodyContains({ email: 'newemail@test.com' })
  })

  test('fail to update with duplicate email', async ({ client }) => {
    await client.post('/api/auth/register').json({
      nombre: 'Existing',
      apellido: 'User',
      email: 'existing@test.com',
      password: '123456',
      rol: 'cliente',
    })

    const token = await registerAndGetToken(client)

    const response = await client
      .put('/api/users/profile')
      .bearerToken(token)
      .json({ email: 'existing@test.com' })

    response.assertStatus(409)
  })

  test('update emergency contact', async ({ client }) => {
    const token = await registerAndGetToken(client)

    const response = await client
      .put('/api/users/profile')
      .bearerToken(token)
      .json({
        contactoEmergenciaNombre: 'Mother',
        contactoEmergenciaTelefono: '987654321',
      })

    response.assertStatus(200)
    response.assertBodyContains({
      contactoEmergenciaNombre: 'Mother',
      contactoEmergenciaTelefono: '987654321',
    })
  })

  test('fail to update profile without authentication', async ({ client }) => {
    const response = await client.put('/api/users/profile').json({ nombre: 'Test' })
    response.assertStatus(401)
  })
})

test.group('Profile - FCM Token', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  async function registerAndGetToken(client: any) {
    const res = await client.post('/api/auth/register').json({
      nombre: 'Fcm',
      apellido: 'User',
      email: `fcm-${Date.now()}@test.com`,
      password: '123456',
      rol: 'cliente',
    })
    return res.body().token
  }

  test('update FCM token', async ({ client }) => {
    const token = await registerAndGetToken(client)

    const response = await client
      .put('/api/users/fcm-token')
      .bearerToken(token)
      .json({ fcmToken: 'test-fcm-token-123' })

    response.assertStatus(200)
    response.assertBodyContains({ fcmToken: 'test-fcm-token-123' })
  })

  test('set FCM token to null', async ({ client, assert }) => {
    const token = await registerAndGetToken(client)

    const response = await client
      .put('/api/users/fcm-token')
      .bearerToken(token)
      .json({ fcmToken: null })

    response.assertStatus(200)
    assert.isNull(response.body().fcmToken)
  })

  test('fail to update FCM token without auth', async ({ client }) => {
    const response = await client.put('/api/users/fcm-token').json({ fcmToken: 'test' })
    response.assertStatus(401)
  })
})
