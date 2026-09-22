import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import db from '@adonisjs/lucid/services/db'
import User from '#models/user'

test.group('ID alignment with Flutter contract', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  async function registerClient(client: any) {
    const res = await client.post('/api/auth/register').json({
      nombre: 'Client',
      apellido: 'Align',
      email: `align-client-${Date.now()}@test.com`,
      password: '123456',
      rol: 'cliente', edad: 30,
    })
    res.assertStatus(200)
    return { token: res.body().token, id: res.body().id }
  }

  async function registerAdmin(client: any) {
    const admin = await User.create({
      nombre: 'Admin',
      apellido: 'Align',
      email: `align-admin-${Date.now()}@test.com`,
      password: '123456',
      rol: 'admin', edad: 30,
    })
    const res = await client.post('/api/auth/login').json({
      email: admin.email,
      password: '123456',
    })
    res.assertStatus(200)
    return { token: res.body().token, id: admin.id }
  }

  async function registerDriver(client: any) {
    const ts = Date.now()
    const res = await client.post('/api/auth/register').json({
      nombre: 'Driver',
      apellido: 'Align',
      email: `align-driver-${Date.now()}@test.com`,
      password: '123456',
      rol: 'conductor', edad: 30,
      cedula: `${ts}`,
      placa: `AL-${ts}`,
      tipoVehiculo: 'camioneta',
      capacidad: '1000 kg',
    })
    res.assertStatus(200)
    await db.from('conductores').where('usuario_id', res.body().id).update({
      estado_verificacion: 'aprobado',
    })
    const conductor = await db
      .from('conductores')
      .where('usuario_id', res.body().id)
      .first()
    return { token: res.body().token, id: res.body().id, conductorId: conductor.id }
  }

  async function createTrip(client: any, clientToken: string) {
    const res = await client.post('/api/trips/request').json({
      origen: { direccion: 'Calle 1', lat: 3.4516, lng: -76.532 },
      destino: { direccion: 'Calle 2', lat: 3.452, lng: -76.531 },
      descripcion: 'carga de prueba',
      precioCliente: 50000,
    }).header('Authorization', `Bearer ${clientToken}`)
    res.assertStatus(200)
    return res.body().id as number
  }

  test('nearby returns _id and id as strings', async ({ client, assert }) => {
    const { token } = await registerDriver(client)
    const { token: clientToken } = await registerClient(client)
    await createTrip(client, clientToken)

    const res = await client
      .get('/api/trips/nearby?lat=3.4516&lng=-76.532')
      .header('Authorization', `Bearer ${token}`)

    res.assertStatus(200)
    const body = res.body()
    const trips = Array.isArray(body) ? body : body.data ?? []
    assert.isNotEmpty(trips)
    for (const trip of trips) {
      assert.isString(trip._id)
      assert.isString(trip.id)
    }
  })

  test('chat allowed in conductor_en_camino and aliases present', async ({ client, assert }) => {
    const { token: clientToken } = await registerClient(client)
    const { token, id: driverUserId, conductorId } = await registerDriver(client)
    const tripId = await createTrip(client, clientToken)

    await db.from('viajes').where('id', tripId).update({
      estado: 'conductor_en_camino',
      conductor_id: conductorId,
    })

    const res = await client
      .post(`/api/trips/${tripId}/chat`)
      .header('Authorization', `Bearer ${token}`)
      .json({ mensaje: 'hola' })

    res.assertStatus(200)
    assert.equal(res.body().tripId, String(tripId))
    assert.equal(res.body().senderId, String(driverUserId))

    const history = await client
      .get(`/api/trips/${tripId}/chat`)
      .header('Authorization', `Bearer ${token}`)
    history.assertStatus(200)
    assert.isBoolean(history.body()[0].isSent)
    assert.isTrue(history.body()[0].isSent)
    assert.equal(history.body()[0].senderId, String(driverUserId))
  })

  test('admin approves cancellation by tripId', async ({ client, assert }) => {
    const { token: clientToken } = await registerClient(client)
    const { token: driverToken, conductorId } = await registerDriver(client)
    const { token: adminToken } = await registerAdmin(client)
    const tripId = await createTrip(client, clientToken)

    await db.from('viajes').where('id', tripId).update({
      estado: 'en_curso',
      conductor_id: conductorId,
    })

    const req = await client
      .post(`/api/trips/${tripId}/request-cancellation`)
      .header('Authorization', `Bearer ${driverToken}`)
      .json({ motivo: 'test' })
    req.assertStatus(200)

    const res = await client
      .post(`/api/admin/cancellation-requests/${tripId}/approve`)
      .header('Authorization', `Bearer ${adminToken}`)

    res.assertStatus(200)
    assert.equal(res.body().viajeId, String(tripId))
    assert.equal(res.body().viajeEstado, 'cancelado')
  })
})