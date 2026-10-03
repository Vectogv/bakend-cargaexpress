import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import { updateProfileValidator } from '#validators/profile'
import User from '#models/user'

test.group('Profile - Show', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  async function registerAndGetToken(client: any, rol: string = 'cliente') {
    const res = await client.post('/api/auth/register').json({
      nombre: 'Test',
      apellido: 'User',
      email: `test-${rol}-${Date.now()}@test.com`,
      password: '123456',
      rol,
      edad: 30,
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
      rol: 'cliente', edad: 30,
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

  test('nombre y apellido no pueden quedar vacíos y se recortan', async ({ client, assert }) => {
    // Igual que adminUpdateUserValidator: si vienen, no pueden quedar vacíos.
    for (const campo of ['nombre', 'apellido']) {
      await assert.rejects(() => updateProfileValidator.validate({ [campo]: '   ' }))
    }

    const token = await registerAndGetToken(client)

    // Por HTTP el bodyparser convierte los textos en blanco a null: se ignoran
    // y el nombre anterior se conserva.
    const vacio = await client
      .put('/api/users/profile')
      .bearerToken(token)
      .json({ nombre: '   ', apellido: '' })
    vacio.assertStatus(200)
    vacio.assertBodyContains({ nombre: 'Original', apellido: 'User' })

    const recortado = await client
      .put('/api/users/profile')
      .bearerToken(token)
      .json({ nombre: '  Ana  ', apellido: ' Pérez ' })
    recortado.assertStatus(200)
    recortado.assertBodyContains({ nombre: 'Ana', apellido: 'Pérez' })
  })

  test('el email no se puede cambiar desde el perfil (se ignora)', async ({ client, assert }) => {
    const token = await registerAndGetToken(client)
    const antes = (await client.get('/api/users/profile').bearerToken(token)).body().email

    const response = await client
      .put('/api/users/profile')
      .bearerToken(token)
      .json({ email: 'newemail@test.com', nombre: 'Otro' })

    response.assertStatus(200)
    response.assertBodyContains({ nombre: 'Otro' })
    const despues = (await client.get('/api/users/profile').bearerToken(token)).body().email
    assert.equal(despues, antes)
  })

  test('cambiar contraseña: exige la actual y la nueva sirve para entrar', async ({ client, assert }) => {
    const email = `pass-${Date.now()}@test.com`
    const token = (
      await client.post('/api/auth/register').json({
        nombre: 'Pass',
        apellido: 'User',
        email,
        password: '123456',
        rol: 'cliente',
        edad: 30,
      })
    ).body().token

    const mala = await client
      .put('/api/users/password')
      .bearerToken(token)
      .json({ actual: 'incorrecta', nueva: 'Nueva12345' })
    mala.assertStatus(422)

    const ok = await client
      .put('/api/users/password')
      .bearerToken(token)
      .json({ actual: '123456', nueva: 'Nueva12345' })
    ok.assertStatus(200)

    // La sesión actual sigue viva.
    ;(await client.get('/api/users/profile').bearerToken(token)).assertStatus(200)
    ;(await client.post('/api/auth/login').json({ email, password: 'Nueva12345' })).assertStatus(200)
    const vieja = await client.post('/api/auth/login').json({ email, password: '123456' })
    assert.notEqual(vieja.status(), 200)
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

test.group('Profile - Asistente de registro del cliente', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('la cuenta nace incompleta y se cierra con cédula, edad y aceptaTerminos', async ({ client, assert }) => {
    const email = `asist-${Date.now()}@test.com`
    // Sin edad: la pide el asistente después de crear la cuenta.
    const reg = await client.post('/api/auth/register').json({
      nombre: 'Paso',
      apellido: 'A paso',
      email,
      password: '123456',
      rol: 'cliente',
      telefono: '3001234567',
    })
    reg.assertStatus(200)
    assert.isFalse(reg.body().perfilCompleto)
    const token = reg.body().token

    const perfil = await client.get('/api/users/profile').bearerToken(token)
    perfil.assertBodyContains({ registroCompleto: false })
    assert.isNull(perfil.body().cedula)

    // Login mientras tanto: sigue incompleto.
    const login = await client.post('/api/auth/login').json({ email, password: '123456' })
    assert.isFalse(login.body().perfilCompleto)

    // Edad menor de 18: 422.
    const menor = await client.put('/api/users/profile').bearerToken(token).json({ edad: 17 })
    menor.assertStatus(422)

    // Datos del asistente sin aceptar términos: sigue incompleto.
    const datos = await client
      .put('/api/users/profile')
      .bearerToken(token)
      .json({ edad: 25, cedula: '1061234567' })
    datos.assertStatus(200)
    datos.assertBodyContains({ edad: 25, cedula: '1061234567', registroCompleto: false })
    assert.isFalse((await client.post('/api/auth/login').json({ email, password: '123456' })).body().perfilCompleto)

    // aceptaTerminos: true cierra el registro.
    const fin = await client.put('/api/users/profile').bearerToken(token).json({ aceptaTerminos: true })
    fin.assertStatus(200)
    fin.assertBodyContains({ registroCompleto: true })
    const user = await User.findByOrFail('email', email)
    assert.isTrue(user.registroCompleto)
    assert.isNotNull(user.terminosAceptadosAt)
    assert.isTrue((await client.post('/api/auth/login').json({ email, password: '123456' })).body().perfilCompleto)

    // aceptaTerminos: false no lo reabre.
    const noReabre = await client.put('/api/users/profile').bearerToken(token).json({ aceptaTerminos: false })
    noReabre.assertBodyContains({ registroCompleto: true })
  })

  test('perfilCompleto exige también teléfono y edad; el conductor nace completo', async ({ client, assert }) => {
    const ts = Date.now()
    // Cliente con términos aceptados desde el registro pero sin teléfono ni edad.
    const sinDatos = await client.post('/api/auth/register').json({
      nombre: 'Sin',
      apellido: 'Datos',
      email: `sd-${ts}@test.com`,
      password: '123456',
      rol: 'cliente',
      aceptaTerminos: true,
    })
    sinDatos.assertStatus(200)
    assert.isFalse(sinDatos.body().perfilCompleto)
    ;(await client.get('/api/users/profile').bearerToken(sinDatos.body().token)).assertBodyContains({
      registroCompleto: true,
    })

    const conductor = await client.post('/api/auth/register').json({
      nombre: 'Con',
      apellido: 'Ductor',
      email: `cd-${ts}@test.com`,
      password: '123456',
      rol: 'conductor',
      edad: 30,
      telefono: '3001234567',
      cedula: `${ts}`,
      placa: `PC${String(ts).slice(-5)}`,
      tipoVehiculo: 'camioneta',
      capacidad: '1000 kg',
    })
    conductor.assertStatus(200)
    assert.isTrue(conductor.body().perfilCompleto)
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
      rol: 'cliente', edad: 30,
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
