import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'

test.group('Auth - Register', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('register a new client user', async ({ client, assert }) => {
    const response = await client.post('/api/auth/register').json({
      nombre: 'Juan',
      apellido: 'Pérez',
      email: 'juan@test.com',
      password: '123456',
      rol: 'cliente',
    })

    response.assertStatus(200)
    response.assertBodyContains({ nombre: 'Juan', email: 'juan@test.com', rol: 'cliente' })
    assert.isDefined(response.body().token)
    assert.isDefined(response.body().refreshToken)
  })

  test('register a new conductor user', async ({ client, assert }) => {
    const ts = Date.now()
    const response = await client.post('/api/auth/register').json({
      nombre: 'Carlos',
      apellido: 'López',
      email: `carlos${ts}@test.com`,
      password: '123456',
      rol: 'conductor',
      cedula: `${ts}`,
      placa: 'ABC-123',
      tipoVehiculo: 'camioneta',
      capacidad: '1000 kg',
    })

    response.assertStatus(200)
    response.assertBodyContains({ nombre: 'Carlos', email: `carlos${ts}@test.com`, rol: 'conductor' })
    assert.isDefined(response.body().token)
    assert.isDefined(response.body().refreshToken)
  })

  test('fail registration with duplicate email', async ({ client }) => {
    await client.post('/api/auth/register').json({
      nombre: 'Ana',
      apellido: 'García',
      email: 'ana@test.com',
      password: '123456',
      rol: 'cliente',
    })

    const response = await client.post('/api/auth/register').json({
      nombre: 'Ana2',
      apellido: 'García',
      email: 'ana@test.com',
      password: '123456',
      rol: 'cliente',
    })

    response.assertStatus(422)
  })

  test('fail registration with invalid email', async ({ client }) => {
    const response = await client.post('/api/auth/register').json({
      nombre: 'Test',
      apellido: 'User',
      email: 'invalid-email',
      password: '123456',
      rol: 'cliente',
    })

    response.assertStatus(422)
  })

  test('fail registration with short password', async ({ client }) => {
    const response = await client.post('/api/auth/register').json({
      nombre: 'Test',
      apellido: 'User',
      email: 'test@test.com',
      password: '123',
      rol: 'cliente',
    })

    response.assertStatus(422)
  })

  test('fail registration with missing conductor fields', async ({ client }) => {
    const response = await client.post('/api/auth/register').json({
      nombre: 'Pedro',
      apellido: 'Ramírez',
      email: 'pedro@test.com',
      password: '123456',
      rol: 'conductor',
    })

    response.assertStatus(422)
    response.assertBodyContains({
      error: 'Cédula, placa, tipo de vehículo y capacidad son requeridas para conductores',
    })
  })

  test('fail registration with invalid rol', async ({ client }) => {
    const response = await client.post('/api/auth/register').json({
      nombre: 'Test',
      apellido: 'User',
      email: 'invalid@test.com',
      password: '123456',
      rol: 'superadmin',
    })

    response.assertStatus(422)
  })
})

test.group('Auth - Login', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('login with valid client credentials', async ({ client }) => {
    await client.post('/api/auth/register').json({
      nombre: 'María',
      apellido: 'González',
      email: 'maria@test.com',
      password: '123456',
      rol: 'cliente',
    })

    const response = await client.post('/api/auth/login').json({
      email: 'maria@test.com',
      password: '123456',
    })

    response.assertStatus(200)
    response.assertBodyContains({ email: 'maria@test.com', nombre: 'María', rol: 'cliente' })
  })

  test('login with valid conductor credentials', async ({ client }) => {
    const ts = Date.now()
    await client.post('/api/auth/register').json({
      nombre: 'Carlos',
      apellido: 'López',
      email: `carlos${ts}@test.com`,
      password: '123456',
      rol: 'conductor',
      cedula: `${ts}`,
      placa: 'ABC-123',
      tipoVehiculo: 'camioneta',
      capacidad: '1000 kg',
    })

    const response = await client.post('/api/auth/login').json({
      email: `carlos${ts}@test.com`,
      password: '123456',
    })

    response.assertStatus(200)
    response.assertBodyContains({ email: `carlos${ts}@test.com`, rol: 'conductor' })
  })

  test('login with invalid password', async ({ client }) => {
    await client.post('/api/auth/register').json({
      nombre: 'Test',
      apellido: 'User',
      email: 'test@test.com',
      password: '123456',
      rol: 'cliente',
    })

    const response = await client.post('/api/auth/login').json({
      email: 'test@test.com',
      password: 'wrongpassword',
    })

    response.assertStatus(400)
    response.assertBodyContains({ errors: [{ message: 'Invalid user credentials' }] })
  })

  test('login with non-existent email', async ({ client }) => {
    const response = await client.post('/api/auth/login').json({
      email: 'noexiste@test.com',
      password: '123456',
    })

    response.assertStatus(400)
  })

  test('login with empty fields', async ({ client }) => {
    const response = await client.post('/api/auth/login').json({
      email: '',
      password: '',
    })

    response.assertStatus(422)
  })
})

test.group('Auth - Refresh Token', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('refresh token successfully', async ({ client, assert }) => {
    const registerResponse = await client.post('/api/auth/register').json({
      nombre: 'Lucía',
      apellido: 'Martínez',
      email: 'lucia@test.com',
      password: '123456',
      rol: 'cliente',
    })

    const refreshToken = registerResponse.body().refreshToken

    const response = await client.post('/api/auth/refresh-token').json({
      refreshToken,
    })

    response.assertStatus(200)
    assert.isDefined(response.body().token)
    assert.isDefined(response.body().refreshToken)
    assert.notEqual(response.body().refreshToken, refreshToken)
  })

  test('fail with invalid refresh token', async ({ client, assert }) => {
    const response = await client.post('/api/auth/refresh-token').json({
      refreshToken: 'invalid-token-123',
    })

    response.assertStatus(200)
    assert.isDefined(response.body().error)
  })

  test('fail with empty refresh token', async ({ client }) => {
    const response = await client.post('/api/auth/refresh-token').json({
      refreshToken: '',
    })

    response.assertStatus(422)
  })
})
