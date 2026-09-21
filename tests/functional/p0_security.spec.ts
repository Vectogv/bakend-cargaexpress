import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import User from '#models/user'
import AlertaEmergencia from '#models/alerta_emergencia'
import Aviso from '#models/aviso'
import db from '@adonisjs/lucid/services/db'

async function registerUser(client: any, rol: string = 'cliente') {
  const res = await client.post('/api/auth/register').json({
    nombre: 'Test',
    apellido: 'User',
    email: `p0-${rol}-${Date.now()}-${Math.random()}@test.com`,
    password: '123456',
    rol,
    edad: 30,
    ...(rol === 'conductor' ? { cedula: `${Date.now()}`, placa: `P0-${Date.now()}`, tipoVehiculo: 'camioneta', capacidad: '1000 kg' } : {}),
  })
  return res.body().token
}

async function createUserToken(client: any, rol: string, extra: Record<string, any> = {}) {
  const user = await User.create({
    nombre: 'Seed',
    apellido: 'User',
    email: `p0-seed-${rol}-${Date.now()}-${Math.random()}@test.com`,
    password: '123456',
    rol,
    ...extra,
  })
  const login = await client.post('/api/auth/login').json({ email: user.email, password: '123456' })
  return login.body().token
}

test.group('P0 - SOS /api/sos (admin monitor)', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('sin autenticacion recibe 401', async ({ client }) => {
    const response = await client.get('/api/sos')
    response.assertStatus(401)
  })

  test('un cliente autenticado no puede acceder (403)', async ({ client }) => {
    const token = await registerUser(client, 'cliente')
    const response = await client.get('/api/sos').bearerToken(token)
    response.assertStatus(403)
  })

  test('un admin obtiene las alertas SOS en el formato esperado por Flutter', async ({ client, assert }) => {
    const admin = await User.create({
      nombre: 'Admin',
      apellido: 'Sos',
      email: `p0-admin-sos-${Date.now()}@test.com`,
      password: '123456',
      rol: 'admin',
    })
    const login = await client.post('/api/auth/login').json({ email: admin.email, password: '123456' })
    const token = login.body().token

    await AlertaEmergencia.create({
      userId: admin.id,
      lat: 3.4516,
      lng: -76.532,
      estado: 'pendiente',
    })
    await AlertaEmergencia.create({
      userId: admin.id,
      lat: 3.452,
      lng: -76.531,
      estado: 'atendida',
    })
    await AlertaEmergencia.create({
      userId: admin.id,
      lat: 3.45,
      lng: -76.53,
      estado: 'resuelta',
    })

    const response = await client.get('/api/sos').bearerToken(token)

    response.assertStatus(200)
    const body = response.body()
    assert.isArray(body)
    assert.equal(body.length, 3)

    const pendiente = body.find((a: any) => a.status === 'pendiente')
    assert.isDefined(pendiente)
    assert.equal(pendiente.driverId, String(admin.id))
    assert.equal(pendiente.latitude, 3.4516)
    assert.equal(pendiente.longitude, -76.532)
    assert.isDefined(pendiente.timestamp)

    const atendiendo = body.find((a: any) => a.status === 'atendiendo')
    assert.isDefined(atendiendo)

    const resuelto = body.find((a: any) => a.status === 'resuelto')
    assert.isDefined(resuelto)
  })
})

test.group('P0 - Fraud /api/fraud/alerts', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('sin autenticacion recibe 401', async ({ client }) => {
    const response = await client.post('/api/fraud/alerts').json({
      type: 'gpsSpoof',
      severity: 'high',
      message: 'test sin auth',
    })
    response.assertStatus(401)
  })

  test('un usuario autenticado puede reportar una alerta de fraude y se persiste', async ({ client, assert }) => {
    const token = await registerUser(client, 'cliente')
    const response = await client
      .post('/api/fraud/alerts')
      .bearerToken(token)
      .json({
        type: 'gpsSpoof',
        severity: 'high',
        message: 'Posible GPS falso',
        data: { distance: 1000, speed: 350 },
        timestamp: new Date().toISOString(),
      })

    response.assertStatus(201)
    response.assertBodyContains({ success: true })

    const logs = await db.from('logs_fraude').where('tipo', 'gpsSpoof')
    assert.isAtLeast(logs.length, 1)
    assert.equal(logs[0].descripcion, 'Posible GPS falso')
  })

  test('requiere el campo type (422)', async ({ client }) => {
    const token = await registerUser(client, 'cliente')
    const response = await client
      .post('/api/fraud/alerts')
      .bearerToken(token)
      .json({ severity: 'high', message: 'sin type' })

    response.assertStatus(422)
  })
})

test.group('P0 - Avisos /api/avisos por rol', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('lectura GET sigue disponible para cualquier usuario autenticado', async ({ client }) => {
    const token = await registerUser(client, 'cliente')
    const response = await client.get('/api/avisos').bearerToken(token)
    response.assertStatus(200)
  })

  test('GET sin autenticacion recibe 401', async ({ client }) => {
    const response = await client.get('/api/avisos')
    response.assertStatus(401)
  })

  test('un cliente no puede publicar avisos (403)', async ({ client }) => {
    const token = await registerUser(client, 'cliente')
    const response = await client
      .post('/api/avisos')
      .bearerToken(token)
      .json({ contenido: 'aviso de un cliente' })

    response.assertStatus(403)
  })

  test('un conductor puede publicar avisos (200)', async ({ client }) => {
    const token = await registerUser(client, 'conductor')
    const response = await client
      .post('/api/avisos')
      .bearerToken(token)
      .json({ contenido: 'aviso del foro' })

    response.assertStatus(200)
    response.assertBodyContains({ contenido: 'aviso del foro' })
  })

  test('un cliente no puede fijar ni eliminar avisos (403)', async ({ client }) => {
    const author = await User.create({
      nombre: 'Autor',
      apellido: 'Aviso',
      email: `p0-autor-${Date.now()}@test.com`,
      password: '123456',
      rol: 'conductor',
    })
    const aviso = await Aviso.create({ autorId: author.id, zona: 'general', contenido: 'para moderar' })

    const token = await registerUser(client, 'cliente')

    const pin = await client.put(`/api/avisos/${aviso.id}/pin`).bearerToken(token)
    pin.assertStatus(403)

    const del = await client.delete(`/api/avisos/${aviso.id}`).bearerToken(token)
    del.assertStatus(403)
  })

  test('un admin puede fijar y eliminar avisos (200)', async ({ client }) => {
    const author = await User.create({
      nombre: 'Autor',
      apellido: 'Aviso',
      email: `p0-autor2-${Date.now()}@test.com`,
      password: '123456',
      rol: 'conductor',
    })
    const aviso = await Aviso.create({ autorId: author.id, zona: 'general', contenido: 'para moderar admin' })

    const token = await createUserToken(client, 'admin')

    const pin = await client.put(`/api/avisos/${aviso.id}/pin`).bearerToken(token)
    pin.assertStatus(200)
    pin.assertBodyContains({ fijado: true })

    const del = await client.delete(`/api/avisos/${aviso.id}`).bearerToken(token)
    del.assertStatus(200)
  })
})