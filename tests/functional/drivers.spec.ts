import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import Conductor from '#models/conductor'

test.group('Drivers - Status', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  async function registerConductor(client: any) {
    const email = `driver-status-${Date.now()}@test.com`
    const ts = Date.now()
    const res = await client.post('/api/auth/register').json({
      nombre: 'Driver',
      apellido: 'Test',
      email,
      password: '123456',
      rol: 'conductor',
      cedula: `87654321${ts}`,
      placa: 'XYZ-789',
      tipoVehiculo: 'sedan',
      capacidad: '500 kg',
    })
    return { token: res.body().token, email }
  }

  test('set driver online', async ({ client, assert }) => {
    const { token } = await registerConductor(client)

    // First, directly set verification to approved so driver can go online
    const userRes = await client.get('/api/users/profile').bearerToken(token)
    const conductorId = userRes.body().conductor.id
    const conductor = await Conductor.find(conductorId)
    if (conductor) {
      conductor.estadoVerificacion = 'aprobado'
      await conductor.save()
    }

    const response = await client
      .put('/api/drivers/status')
      .bearerToken(token)
      .json({ online: true })

    response.assertStatus(200)
    assert.isTrue(response.body().online)
    assert.isDefined(response.body().updatedAt)
  })

  test('set driver offline', async ({ client, assert }) => {
    const { token } = await registerConductor(client)

    const response = await client
      .put('/api/drivers/status')
      .bearerToken(token)
      .json({ online: false })

    response.assertStatus(200)
    assert.isFalse(response.body().online)
  })

  test('fail to set online when not verified', async ({ client }) => {
    const { token } = await registerConductor(client)

    const response = await client
      .put('/api/drivers/status')
      .bearerToken(token)
      .json({ online: true })

    response.assertStatus(403)
    response.assertBodyContains({ error: 'Debes estar verificado para ponerte online' })
  })

  test('fail for non-conductor user', async ({ client }) => {
    const res = await client.post('/api/auth/register').json({
      nombre: 'Client',
      apellido: 'User',
      email: `client-only-${Date.now()}@test.com`,
      password: '123456',
      rol: 'cliente',
    })
    const token = res.body().token

    const response = await client
      .put('/api/drivers/status')
      .bearerToken(token)
      .json({ online: false })

    response.assertStatus(200)
    response.assertBodyContains({ error: 'Conductor profile not found' })
  })

  test('fail with invalid status value', async ({ client }) => {
    const { token } = await registerConductor(client)

    const response = await client
      .put('/api/drivers/status')
      .bearerToken(token)
      .json({ online: 'invalid' })

    response.assertStatus(422)
  })

  test('fail without authentication', async ({ client }) => {
    const response = await client.put('/api/drivers/status').json({ online: true })
    response.assertStatus(401)
  })
})

test.group('Drivers - Location', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  async function registerConductor(client: any) {
    const ts = Date.now()
    const res = await client.post('/api/auth/register').json({
      nombre: 'Driver',
      apellido: 'Loc',
      email: `driver-loc-${ts}@test.com`,
      password: '123456',
      rol: 'conductor',
      cedula: `11111111${ts}`,
      placa: 'LOC-001',
      tipoVehiculo: 'suv',
      capacidad: '800 kg',
    })
    return res.body().token
  }

  test('update location successfully', async ({ client, assert }) => {
    const token = await registerConductor(client)

    const response = await client
      .put('/api/drivers/location')
      .bearerToken(token)
      .json({ lat: 19.4326, lng: -99.1332 })

    response.assertStatus(200)
    assert.strictEqual(response.body().lat, 19.4326)
    assert.strictEqual(response.body().lng, -99.1332)
    assert.isDefined(response.body().updatedAt)
  })

  test('fail with invalid latitude', async ({ client }) => {
    const token = await registerConductor(client)

    const response = await client
      .put('/api/drivers/location')
      .bearerToken(token)
      .json({ lat: 100, lng: -99.1332 })

    response.assertStatus(422)
  })

  test('fail with invalid longitude', async ({ client }) => {
    const token = await registerConductor(client)

    const response = await client
      .put('/api/drivers/location')
      .bearerToken(token)
      .json({ lat: 19.4326, lng: -200 })

    response.assertStatus(422)
  })

  test('fail without authentication', async ({ client }) => {
    const response = await client.put('/api/drivers/location').json({ lat: 19.4326, lng: -99.1332 })
    response.assertStatus(401)
  })
})

test.group('Drivers - Earnings', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  async function registerConductor(client: any) {
    const ts = Date.now()
    const res = await client.post('/api/auth/register').json({
      nombre: 'Driver',
      apellido: 'Earn',
      email: `driver-earn-${ts}@test.com`,
      password: '123456',
      rol: 'conductor',
      cedula: `22222222${ts}`,
      placa: 'ERN-002',
      tipoVehiculo: 'pickup',
      capacidad: '1500 kg',
    })
    return res.body().token
  }

  test('get earnings with zero values', async ({ client, assert }) => {
    const token = await registerConductor(client)

    const response = await client.get('/api/drivers/earnings').bearerToken(token)

    response.assertStatus(200)
    assert.isDefined(response.body().hoy)
    assert.isDefined(response.body().semana)
    assert.isDefined(response.body().mes)
    assert.isDefined(response.body().total)
    assert.equal(response.body().hoy.viajesCompletados, 0)
    assert.equal(response.body().hoy.montoBruto, 0)
    assert.equal(response.body().total.viajesCompletados, 0)
  })

  test('get earnings history', async ({ client }) => {
    const token = await registerConductor(client)

    const response = await client.get('/api/drivers/earnings/history').bearerToken(token)

    response.assertStatus(200)
    response.assertBodyContains({ data: [], total: 0 })
  })

  test('get earnings history with pagination', async ({ client }) => {
    const token = await registerConductor(client)

    const response = await client
      .get('/api/drivers/earnings/history')
      .bearerToken(token)
      .qs({ page: 1, limit: 10 })

    response.assertStatus(200)
    assert.equal(response.body().page, 1)
    assert.equal(response.body().limit, 10)
  })

  test('get earnings history filtered by period', async ({ client }) => {
    const token = await registerConductor(client)

    const response = await client
      .get('/api/drivers/earnings/history')
      .bearerToken(token)
      .qs({ periodo: 'mes' })

    response.assertStatus(200)
  })

  test('get earnings PDF', async ({ client }) => {
    const token = await registerConductor(client)

    const response = await client.get('/api/drivers/earnings/pdf').bearerToken(token)

    response.assertStatus(200)
    response.assertHeader('Content-Type', 'application/pdf')
  })

  test('get earnings PDF with period', async ({ client }) => {
    const token = await registerConductor(client)

    const response = await client
      .get('/api/drivers/earnings/pdf')
      .bearerToken(token)
      .qs({ periodo: 'semana' })

    response.assertStatus(200)
    response.assertHeader('Content-Type', 'application/pdf')
  })

  test('fail earnings without auth', async ({ client }) => {
    const response = await client.get('/api/drivers/earnings')
    response.assertStatus(401)
  })
})

test.group('Drivers - Stats', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  async function registerConductor(client: any) {
    const res = await client.post('/api/auth/register').json({
      nombre: 'Driver',
      apellido: 'Stats',
      email: `driver-stats-${Date.now()}@test.com`,
      password: '123456',
      rol: 'conductor',
      cedula: '33333333',
      placa: 'STA-003',
      tipoVehiculo: 'van',
      capacidad: '2000 kg',
    })
    return res.body().token
  }

  test('get driver stats', async ({ client, assert }) => {
    const token = await registerConductor(client)

    const response = await client.get('/api/drivers/stats').bearerToken(token)

    response.assertStatus(200)
    assert.isDefined(response.body().viajes)
    assert.isDefined(response.body().horasActivo)
    assert.isDefined(response.body().calificacion)
    assert.equal(response.body().viajes, 0)
    assert.equal(response.body().horasActivo, 0)
  })

  test('get today stats', async ({ client, assert }) => {
    const token = await registerConductor(client)

    const response = await client.get('/api/drivers/today-stats').bearerToken(token)

    response.assertStatus(200)
    assert.equal(response.body().viajesHoy, 0)
    assert.equal(response.body().gananciasHoy, 0)
    assert.equal(response.body().comisionHoy, 0)
    assert.equal(response.body().netaHoy, 0)
    assert.isDefined(response.body().calificacion)
  })

  test('fail stats without auth', async ({ client }) => {
    const response = await client.get('/api/drivers/stats')
    response.assertStatus(401)
  })

  test('fail today-stats without auth', async ({ client }) => {
    const response = await client.get('/api/drivers/today-stats')
    response.assertStatus(401)
  })
})

test.group('Drivers - Photos', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  async function registerConductor(client: any) {
    const res = await client.post('/api/auth/register').json({
      nombre: 'Driver',
      apellido: 'Photo',
      email: `driver-photo-${Date.now()}@test.com`,
      password: '123456',
      rol: 'conductor',
      cedula: '44444444',
      placa: 'PHO-004',
      tipoVehiculo: 'hatchback',
      capacidad: '300 kg',
    })
    return res.body().token
  }

  test('fail vehicle photo without file', async ({ client }) => {
    const token = await registerConductor(client)

    const response = await client.post('/api/drivers/vehicle-photo').bearerToken(token)

    response.assertStatus(200)
    response.assertBodyContains({ error: 'No file uploaded' })
  })

  test('fail driver photo without file', async ({ client }) => {
    const token = await registerConductor(client)

    const response = await client.post('/api/drivers/driver-photo').bearerToken(token)

    response.assertStatus(200)
    response.assertBodyContains({ error: 'No file uploaded' })
  })

  test('fail vehicle photo without auth', async ({ client }) => {
    const response = await client.post('/api/drivers/vehicle-photo')
    response.assertStatus(401)
  })

  test('fail driver photo without auth', async ({ client }) => {
    const response = await client.post('/api/drivers/driver-photo')
    response.assertStatus(401)
  })
})

test.group('Drivers - Verification', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  async function registerConductor(client: any) {
    const res = await client.post('/api/auth/register').json({
      nombre: 'Driver',
      apellido: 'Verif',
      email: `driver-verif-${Date.now()}@test.com`,
      password: '123456',
      rol: 'conductor',
      cedula: '55555555',
      placa: 'VER-005',
      tipoVehiculo: 'coupé',
      capacidad: '200 kg',
    })
    return res.body().token
  }

  test('fail upload cedula without file', async ({ client }) => {
    const token = await registerConductor(client)

    const response = await client.post('/api/drivers/verification/cedula').bearerToken(token)

    response.assertStatus(200)
    response.assertBodyContains({ error: 'No file uploaded' })
  })

  test('fail upload licencia without file', async ({ client }) => {
    const token = await registerConductor(client)

    const response = await client.post('/api/drivers/verification/licencia').bearerToken(token)

    response.assertStatus(200)
    response.assertBodyContains({ error: 'No file uploaded' })
  })

  test('fail upload vehiculo verification without file', async ({ client }) => {
    const token = await registerConductor(client)

    const response = await client.post('/api/drivers/verification/vehiculo').bearerToken(token)

    response.assertStatus(200)
    response.assertBodyContains({ error: 'No file uploaded' })
  })

  test('fail verification without auth', async ({ client }) => {
    const response = await client.post('/api/drivers/verification/cedula')
    response.assertStatus(401)
  })
})
