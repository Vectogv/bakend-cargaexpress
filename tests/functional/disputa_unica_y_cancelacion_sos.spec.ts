import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import testUtils from '@adonisjs/core/services/test_utils'
import ConfiguracionPlataforma from '#models/configuracion_plataforma'
import User from '#models/user'

/**
 * 1) Un viaje tiene una sola disputa: si el cliente ya abrió una disputa y luego
 *    rechaza el cierre, se reutiliza la existente en vez de crear otra.
 * 2) Durante un SOS el cliente no puede cancelar directamente: debe solicitar
 *    la cancelación (revisión), igual que en 'en_curso'/'conductor_llegada'.
 */

const uniq = () => `${Date.now()}${Math.floor(Math.random() * 1e6)}`
const ORIGEN = { direccion: 'Origen único', lat: 2.4419, lng: -76.6063 }
const DESTINO = { direccion: 'Destino único', lat: 2.4569, lng: -76.5952 }

async function registrarCliente(client: any) {
  const res = await client.post('/api/auth/register').json({
    nombre: 'Cli',
    apellido: 'Unica',
    email: `du_cli_${uniq()}@test.com`,
    password: 'Password123',
    rol: 'cliente',
    edad: 30,
  })
  res.assertStatus(200)
  return { token: res.body().token as string, id: Number(res.body().id) }
}

async function registrarConductor(client: any) {
  const res = await client.post('/api/auth/register').json({
    nombre: 'Con',
    apellido: 'Unica',
    email: `du_con_${uniq()}@test.com`,
    password: 'Password123',
    rol: 'conductor',
    edad: 35,
    cedula: `${uniq()}`.slice(-10),
    placa: `DUS${`${uniq()}`.slice(-5)}`,
    tipoVehiculo: 'camioneta',
    capacidad: '1 tonelada',
    ciudad: 'popayan',
  })
  res.assertStatus(200)
  const userId = Number(res.body().id)
  await db
    .from('conductores')
    .where('usuario_id', userId)
    .update({ estado_verificacion: 'aprobado' })
  const conductor = await db.from('conductores').where('usuario_id', userId).first()
  return { token: res.body().token as string, userId, conductorId: Number(conductor.id) }
}

async function ubicar(conductorId: number, lat: number, lng: number) {
  await db.from('conductores').where('id', conductorId).update({
    ultima_ubicacion_lat: lat,
    ultima_ubicacion_lng: lng,
    ubicacion_actualizada_en: DateTime.now().toSQL(),
  })
}

async function crearAdmin(client: any) {
  const admin = await User.create({
    nombre: 'Admin',
    apellido: 'Unica',
    email: `du_admin_${uniq()}@test.com`,
    password: 'Password123',
    rol: 'admin',
  })
  const login = await client
    .post('/api/auth/login')
    .json({ email: admin.email, password: 'Password123' })
  login.assertStatus(200)
  return login.body().token as string
}

/** Viaje aceptado y en curso. */
async function viajeEnCurso(client: any) {
  const cliente = await registrarCliente(client)
  const driver = await registrarConductor(client)
  const viaje = await client.post('/api/trips/request').bearerToken(cliente.token).json({
    origen: ORIGEN,
    destino: DESTINO,
    descripcion: 'Carga de prueba',
    precioCliente: 40000,
  })
  viaje.assertStatus(200)
  const tripId = Number(viaje.body().id)

  ;(await client.post(`/api/trips/${tripId}/accept`).bearerToken(driver.token)).assertStatus(200)
  await ubicar(driver.conductorId, ORIGEN.lat, ORIGEN.lng)
  ;(await client.post(`/api/trips/${tripId}/start-trip`).bearerToken(driver.token)).assertStatus(
    200
  )
  return { cliente, driver, tripId }
}

/** Viaje en curso con SOS activado por el conductor. */
async function viajeEnSos(client: any) {
  const ctx = await viajeEnCurso(client)
  const sos = await client.post('/api/emergency').bearerToken(ctx.driver.token).json({
    viajeId: ctx.tripId,
    lat: ORIGEN.lat,
    lng: ORIGEN.lng,
    motivo: 'Vehículo interceptado',
  })
  sos.assertStatus(201)
  const fila = await db.from('viajes').where('id', ctx.tripId).first()
  if (fila.estado !== 'sos') throw new Error(`Se esperaba estado sos, está en ${fila.estado}`)
  return ctx
}

test.group('Disputa única al rechazar el cierre', (group) => {
  group.each.setup(async () => {
    await ConfiguracionPlataforma.query().delete()
  })

  test('si el cliente ya abrió una disputa, rechazar el cierre la reutiliza', async ({
    client,
    assert,
  }) => {
    const { cliente, driver, tripId } = await viajeEnCurso(client)
    await ubicar(driver.conductorId, DESTINO.lat, DESTINO.lng)
    ;(
      await client
        .post(`/api/trips/${tripId}/complete`)
        .bearerToken(driver.token)
        .json({ montoFinal: 40000 })
    ).assertStatus(200)

    const abierta = await client.post('/api/disputes').bearerToken(cliente.token).json({
      tripId,
      problema: 'carga_incompleta',
      descripcion: 'Faltan cajas',
    })
    abierta.assertStatus(201)
    const disputaId = Number(abierta.body().id)

    const rechazo = await client
      .post(`/api/trips/${tripId}/confirm-close`)
      .bearerToken(cliente.token)
      .json({ confirmar: false, motivo: 'La carga no llegó completa' })
    rechazo.assertStatus(200)
    rechazo.assertBodyContains({ id: String(tripId), estado: 'disputa' })
    assert.equal(Number(rechazo.body().disputaId), disputaId)

    const disputas = await db.from('disputas').where('viaje_id', tripId)
    assert.lengthOf(disputas, 1, 'El viaje debe tener exactamente una disputa')
    const viaje = await db.from('viajes').where('id', tripId).first()
    assert.equal(viaje.estado, 'disputa')
  })

  test('el conductor no puede cambiar el precio acordado al cerrar', async ({ client, assert }) => {
    const { driver, tripId } = await viajeEnCurso(client)
    await ubicar(driver.conductorId, DESTINO.lat, DESTINO.lng)
    const cierre = await client
      .post(`/api/trips/${tripId}/complete`)
      .bearerToken(driver.token)
      .json({ montoFinal: 99999 })
    cierre.assertStatus(200)
    cierre.assertBodyContains({ montoFinal: 40000 })
    const viaje = await db.from('viajes').where('id', tripId).first()
    assert.equal(Number(viaje.precio_final), 40000)
  })

  test('sin disputa previa, rechazar el cierre crea una sola', async ({ client, assert }) => {
    const { cliente, driver, tripId } = await viajeEnCurso(client)
    await ubicar(driver.conductorId, DESTINO.lat, DESTINO.lng)
    ;(
      await client
        .post(`/api/trips/${tripId}/complete`)
        .bearerToken(driver.token)
        .json({ montoFinal: 40000 })
    ).assertStatus(200)

    const rechazo = await client
      .post(`/api/trips/${tripId}/confirm-close`)
      .bearerToken(cliente.token)
      .json({ confirmar: false, motivo: 'No llegó' })
    rechazo.assertStatus(200)

    const disputas = await db.from('disputas').where('viaje_id', tripId)
    assert.lengthOf(disputas, 1)
    assert.equal(Number(rechazo.body().disputaId), Number(disputas[0].id))
    assert.equal(disputas[0].problema, 'cliente_rechaza_cierre')
  })
})

test.group('Cancelación durante SOS requiere revisión', (group) => {
  // Transacción global: las alertas SOS de prueba no deben filtrarse a otras
  // suites (/api/sos lista todas las alertas de la base).
  group.each.setup(async () => {
    const rollback = await testUtils.db().withGlobalTransaction()
    await ConfiguracionPlataforma.query().delete()
    return rollback
  })

  test('el cliente no puede cancelar directamente un viaje en SOS', async ({ client, assert }) => {
    const { cliente, tripId } = await viajeEnSos(client)

    const res = await client
      .post(`/api/trips/${tripId}/cancel`)
      .bearerToken(cliente.token)
      .json({ motivo: 'Ya no lo necesito' })
    res.assertStatus(403)

    const viaje = await db.from('viajes').where('id', tripId).first()
    assert.equal(viaje.estado, 'sos')
  })

  test('el cliente puede solicitar la cancelación de un viaje en SOS', async ({
    client,
    assert,
  }) => {
    const { cliente, tripId } = await viajeEnSos(client)

    const res = await client
      .post(`/api/trips/${tripId}/request-cancellation`)
      .bearerToken(cliente.token)
      .json({ motivo: 'Emergencia en ruta' })
    assert.oneOf(res.status(), [200, 201])

    const solicitud = await db
      .from('solicitudes_cancelacion')
      .where('viaje_id', tripId)
      .where('estado', 'pendiente')
      .first()
    assert.isNotNull(solicitud)
  })

  test('al resolver el SOS el viaje vuelve a en_curso y se puede completar', async ({
    client,
    assert,
  }) => {
    const { driver, tripId } = await viajeEnSos(client)
    const alerta = await db.from('alertas_emergencia').where('viaje_id', tripId).first()
    const adminToken = await crearAdmin(client)

    const res = await client
      .put(`/api/admin/emergencies/${alerta.id}/resolve`)
      .bearerToken(adminToken)
    res.assertStatus(200)
    res.assertBodyContains({ estadoViaje: 'en_curso' })
    const viaje = await db.from('viajes').where('id', tripId).first()
    assert.equal(viaje.estado, 'en_curso')

    await ubicar(driver.conductorId, DESTINO.lat, DESTINO.lng)
    const cierre = await client
      .post(`/api/trips/${tripId}/complete`)
      .bearerToken(driver.token)
      .json({ montoFinal: 40000 })
    cierre.assertStatus(200)
  })

  test('con otra alerta sin atender el viaje sigue en SOS', async ({ client, assert }) => {
    const { cliente, tripId } = await viajeEnSos(client)
    const segunda = await client
      .post('/api/emergency')
      .bearerToken(cliente.token)
      .json({ viajeId: tripId, motivo: 'También el cliente' })
    segunda.assertStatus(201)
    const primera = await db
      .from('alertas_emergencia')
      .where('viaje_id', tripId)
      .orderBy('id')
      .first()
    const adminToken = await crearAdmin(client)

    const res = await client
      .put(`/api/admin/emergencies/${primera.id}/resolve`)
      .bearerToken(adminToken)
    res.assertStatus(200)
    const viaje = await db.from('viajes').where('id', tripId).first()
    assert.equal(viaje.estado, 'sos')
  })

  test('el admin sí puede cancelar un viaje en SOS', async ({ client, assert }) => {
    const { tripId } = await viajeEnSos(client)
    const adminToken = await crearAdmin(client)

    const res = await client
      .post(`/api/trips/${tripId}/cancel`)
      .bearerToken(adminToken)
      .json({ motivo: 'Cancelado por soporte tras SOS' })
    res.assertStatus(200)
    res.assertBodyContains({ estado: 'cancelado' })

    const viaje = await db.from('viajes').where('id', tripId).first()
    assert.equal(viaje.estado, 'cancelado')
  })
})
