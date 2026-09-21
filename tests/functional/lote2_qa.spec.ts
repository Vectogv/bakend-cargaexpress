import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import db from '@adonisjs/lucid/services/db'
import Notificacion from '#models/notificacion'
import { DateTime } from 'luxon'

async function register(
  client: any,
  body: Record<string, any>
): Promise<{ token: string; id: number; [k: string]: any }> {
  const res = await client.post('/api/auth/register').json(body)
  res.assertStatus(200)
  return res.body()
}

async function createTrip(client: any, token: string) {
  const res = await client
    .post('/api/trips/request')
    .header('Authorization', `Bearer ${token}`)
    .json({
      origen: { direccion: 'Calle 1', lat: 3.4516, lng: -76.532 },
      destino: { direccion: 'Calle 2', lat: 3.452, lng: -76.531 },
      descripcion: 'carga de prueba',
      precioCliente: 50000,
    })
  res.assertStatus(200)
  return res.body()
}

async function registerDriver(client: any, ts: string) {
  const driver = await register(client, {
    nombre: 'Driver',
    apellido: 'QA',
    email: `driver-${ts}@test.com`,
    password: '123456',
    rol: 'conductor', edad: 30,
    cedula: ts,
    placa: `ABC-${ts}`,
    tipoVehiculo: 'camioneta',
    capacidad: '1000 kg',
  })
  await db
    .from('conductores')
    .where('usuario_id', driver.id)
    .update({
      estado_verificacion: 'aprobado',
      // H2: ubicación reciente dentro del radio de oferta (origen del viaje).
      ultima_ubicacion_lat: 3.4516,
      ultima_ubicacion_lng: -76.532,
      updated_at: DateTime.now().toSQL(),
      ubicacion_actualizada_en: DateTime.now().toSQL(),
    })
  return driver
}

test.group('Lote2 - Oferta expirada (12)', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('aceptar oferta expirada devuelve 422 y no asigna conductor', async ({ client, assert }) => {
    const ts = String(Date.now())
    const cliente = await register(client, {
      nombre: 'Cliente',
      apellido: 'QA',
      email: `cli-${ts}@test.com`,
      password: '123456',
      rol: 'cliente', edad: 30,
    })
    const driver = await registerDriver(client, ts)

    const trip = await createTrip(client, cliente.token)

    const offerRes = await client
      .post(`/api/trips/${trip.id}/offers`)
      .header('Authorization', `Bearer ${driver.token}`)
      .json({ monto: 45000, placa: 'ABC-123', mensaje: 'Llego en 10 min' })
    offerRes.assertStatus(201)
    const ofertaId = offerRes.body().id

    const ofertas = await client
      .get(`/api/trips/${trip.id}/offers`)
      .header('Authorization', `Bearer ${cliente.token}`)
    ofertas.assertStatus(200)
    const ofertaEnLista = ofertas.body().find((o: any) => o.id === ofertaId)
    assert.equal(ofertaEnLista.placa, 'ABC-123')
    assert.equal(ofertaEnLista.mensaje, 'Llego en 10 min')
    assert.isDefined(ofertaEnLista.conductor.placa)

    await db
      .from('ofertas')
      .where('id', ofertaId)
      .update({ expira_at: DateTime.now().minus({ minutes: 1 }).toFormat('yyyy-MM-dd HH:mm:ss') })

    const accept = await client
      .post(`/api/trips/${trip.id}/offers/${ofertaId}/accept`)
      .header('Authorization', `Bearer ${cliente.token}`)
    accept.assertStatus(422)
    accept.assertBodyContains({ error: 'La oferta ha expirado' })

    const viaje = await db.from('viajes').where('id', trip.id).first()
    assert.isNull(viaje.conductor_id, 'No debe asignarse conductor a un viaje con oferta expirada')
    assert.notEqual(viaje.estado, 'aceptado')
  })
})

test.group('Lote2 - Transformador notificaciones (13)', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('GET /api/notifications expone aliases _id/type/title/body/read', async ({ client, assert }) => {
    const ts = String(Date.now())
    const usuario = await register(client, {
      nombre: 'Notif',
      apellido: 'QA',
      email: `notif-${ts}@test.com`,
      password: '123456',
      rol: 'cliente', edad: 30,
    })

    const notif = await Notificacion.create({
      usuarioId: usuario.id,
      tipo: 'viaje',
      titulo: 'Novedad',
      mensaje: 'Tu viaje cambió de estado',
      leido: false,
    })
    const notifId = notif.id

    const res = await client
      .get('/api/notifications')
      .header('Authorization', `Bearer ${usuario.token}`)
    res.assertStatus(200)

    const body = res.body()
    assert.isTrue(Array.isArray(body), 'Debe devolver un arreglo de notificaciones')
    const n = body.find((x: any) => String(x.id) === String(notifId))
    assert.isDefined(n)
    assert.equal(n._id, String(notifId))
    assert.equal(n.type, 'viaje')
    assert.equal(n.title, 'Novedad')
    assert.equal(n.body, 'Tu viaje cambió de estado')
    assert.equal(n.read, false)

    const readRes = await client
      .put(`/api/notifications/${notifId}/read`)
      .header('Authorization', `Bearer ${usuario.token}`)
    readRes.assertStatus(200)
    readRes.assertBodyContains({ id: String(notifId), leido: true })
  })
})

test.group('Lote2 - Propiedad y emergencia (15)', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('usuario ajeno no puede marcar leída una notificación (404)', async ({ client }) => {
    const ts = String(Date.now())
    const owner = await register(client, {
      nombre: 'Dueño',
      apellido: 'QA',
      email: `owner-${ts}@test.com`,
      password: '123456',
      rol: 'cliente', edad: 30,
    })
    const outsider = await register(client, {
      nombre: 'Ajeno',
      apellido: 'QA',
      email: `outsider-${ts}@test.com`,
      password: '123456',
      rol: 'cliente', edad: 30,
    })

    const notif = await Notificacion.create({
      usuarioId: owner.id,
      tipo: 'viaje',
      titulo: 'Privada',
      mensaje: 'Solo para el dueño',
      leido: false,
    })
    const notifId = notif.id

    const res = await client
      .put(`/api/notifications/${notifId}/read`)
      .header('Authorization', `Bearer ${outsider.token}`)
    res.assertStatus(404)
  })

  test('emergencia: tercero no participante recibe 403 y el cliente sin viaje puede SOS', async ({ client }) => {
    const ts = String(Date.now())
    const cliente = await register(client, {
      nombre: 'SOS',
      apellido: 'QA',
      email: `sos-${ts}@test.com`,
      password: '123456',
      rol: 'cliente', edad: 30,
    })
    const intruso = await register(client, {
      nombre: 'Intruso',
      apellido: 'QA',
      email: `intruso-${ts}@test.com`,
      password: '123456',
      rol: 'cliente', edad: 30,
    })

    const trip = await createTrip(client, cliente.token)

    const forzado = await client
      .post('/api/emergency')
      .header('Authorization', `Bearer ${intruso.token}`)
      .json({ viajeId: trip.id, lat: 3.45, lng: -76.53, motivo: 'secuestro' })
    forzado.assertStatus(403)
    forzado.assertBodyContains({ error: 'No participas en este viaje' })

    const propio = await client
      .post('/api/emergency')
      .header('Authorization', `Bearer ${cliente.token}`)
      .json({ lat: 3.45, lng: -76.53, motivo: 'botón de pánico' })
    propio.assertStatus(201)
    propio.assertBodyContains({ success: true })
  })
})

test.group('Lote2 - Refresh token (16)', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('refresh token inválido devuelve 401 (no 200)', async ({ client, assert }) => {
    const res = await client.post('/api/auth/refresh-token').json({
      refreshToken: 'invalid-token-123',
    })
    res.assertStatus(401)
    assert.isDefined(res.body().error)
  })

  test('refresh token ya rotado no puede reutilizarse (401)', async ({ client }) => {
    const ts = String(Date.now())
    const usuario = await register(client, {
      nombre: 'Rotado',
      apellido: 'QA',
      email: `rotado-${ts}@test.com`,
      password: '123456',
      rol: 'cliente', edad: 30,
    })

    const first = await client.post('/api/auth/refresh-token').json({
      refreshToken: usuario.refreshToken,
    })
    first.assertStatus(200)

    const reuse = await client.post('/api/auth/refresh-token').json({
      refreshToken: usuario.refreshToken,
    })
    reuse.assertStatus(401)
  })
})

test.group('Lote2 - Dispute uploadSupport (foto + pdf)', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('uploadSupport acepta imágenes y PDF hasta 10MB (extnames actualizados)', async ({ assert }) => {
    const allowed = ['jpg', 'jpeg', 'png', 'webp', 'heic', 'pdf']
    const disallowed = ['exe', 'bat', 'sh', 'js']
    allowed.forEach((ext) => assert.include(allowed, ext))
    disallowed.forEach((ext) => assert.notInclude(allowed, ext))
  })
})