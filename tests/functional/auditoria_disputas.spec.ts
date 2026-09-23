import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import ConfiguracionPlataforma from '#models/configuracion_plataforma'
import User from '#models/user'

/**
 * Auditoría CRÍTICO #2: resolver una disputa (admin) debe cerrar el viaje;
 * antes quedaba en 'disputa' para siempre y el cliente no podía pedir otro.
 */

const uniq = () => `${Date.now()}${Math.floor(Math.random() * 1e6)}`
const ORIGEN = { direccion: 'Origen disputa', lat: 2.4419, lng: -76.6063 }
const DESTINO = { direccion: 'Destino disputa', lat: 2.4569, lng: -76.5952 }

async function registrarCliente(client: any) {
  const res = await client.post('/api/auth/register').json({
    nombre: 'Cli',
    apellido: 'Disputa',
    email: `disp_cli_${uniq()}@test.com`,
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
    apellido: 'Disputa',
    email: `disp_con_${uniq()}@test.com`,
    password: 'Password123',
    rol: 'conductor',
    edad: 35,
    cedula: `${uniq()}`.slice(-10),
    placa: `DSP${`${uniq()}`.slice(-5)}`,
    tipoVehiculo: 'camioneta',
    capacidad: '1 tonelada',
    ciudad: 'popayan',
  })
  res.assertStatus(200)
  const userId = Number(res.body().id)
  await db.from('conductores').where('usuario_id', userId).update({ estado_verificacion: 'aprobado' })
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
    apellido: 'Disputas',
    email: `disp_admin_${uniq()}@test.com`,
    password: 'Password123',
    rol: 'admin',
  })
  const login = await client.post('/api/auth/login').json({ email: admin.email, password: 'Password123' })
  login.assertStatus(200)
  return login.body().token as string
}

async function pedirViaje(client: any, token: string) {
  return client.post('/api/trips/request').bearerToken(token).json({
    origen: ORIGEN,
    destino: DESTINO,
    descripcion: 'Carga en disputa',
    precioCliente: 40000,
  })
}

/** Lleva un viaje hasta 'disputa' (el cliente rechaza el cierre del conductor). */
async function viajeEnDisputa(client: any) {
  const cliente = await registrarCliente(client)
  const driver = await registrarConductor(client)
  const viaje = await pedirViaje(client, cliente.token)
  viaje.assertStatus(200)
  const tripId = Number(viaje.body().id)

  ;(await client.post(`/api/trips/${tripId}/accept`).bearerToken(driver.token)).assertStatus(200)
  await ubicar(driver.conductorId, ORIGEN.lat, ORIGEN.lng)
  ;(await client.post(`/api/trips/${tripId}/start-trip`).bearerToken(driver.token)).assertStatus(200)
  await ubicar(driver.conductorId, DESTINO.lat, DESTINO.lng)
  ;(
    await client.post(`/api/trips/${tripId}/complete`).bearerToken(driver.token).json({ montoFinal: 40000 })
  ).assertStatus(200)
  const rechazo = await client
    .post(`/api/trips/${tripId}/confirm-close`)
    .bearerToken(cliente.token)
    .json({ confirmar: false, motivo: 'La carga no llegó completa' })
  rechazo.assertStatus(200)
  rechazo.assertBodyContains({ estado: 'disputa' })

  const disputa = await db.from('disputas').where('viaje_id', tripId).first()
  return { cliente, driver, tripId, disputaId: Number(disputa.id) }
}

test.group('Auditoría #2 - resolver disputa cierra el viaje', (group) => {
  group.each.setup(async () => {
    await ConfiguracionPlataforma.query().delete()
  })

  test('a favor del conductor: el viaje se finaliza y el cliente puede pedir otro', async ({
    client,
    assert,
  }) => {
    const { cliente, tripId, disputaId } = await viajeEnDisputa(client)
    const adminToken = await crearAdmin(client)

    const res = await client
      .put(`/api/admin/disputes/${disputaId}/resolve`)
      .bearerToken(adminToken)
      .json({ resultado: 'favor_conductor' })
    res.assertStatus(200)
    res.assertBodyContains({ estado: 'resuelta', viajeEstado: 'finalizado' })

    const viaje = await db.from('viajes').where('id', tripId).first()
    assert.equal(viaje.estado, 'finalizado')
    assert.isNotNull(viaje.finalizado_at)
    const ganancias = await db.from('ganancias').where('viaje_id', tripId)
    assert.lengthOf(ganancias, 1, 'La finalización genera exactamente una ganancia')

    // Resolver otra vez no vuelve a mover dinero.
    const repetida = await client
      .put(`/api/admin/disputes/${disputaId}/resolve`)
      .bearerToken(adminToken)
      .json({ resultado: 'favor_conductor' })
    repetida.assertStatus(400)
    assert.lengthOf(await db.from('ganancias').where('viaje_id', tripId), 1)

    const nuevo = await pedirViaje(client, cliente.token)
    nuevo.assertStatus(200)
  })

  test('a favor del cliente: el viaje se cancela sin ganancia y el cliente puede pedir otro', async ({
    client,
    assert,
  }) => {
    const { cliente, tripId, disputaId } = await viajeEnDisputa(client)
    const adminToken = await crearAdmin(client)

    const res = await client
      .put(`/api/admin/disputes/${disputaId}/resolve`)
      .bearerToken(adminToken)
      .json({ resultado: 'favor_cliente' })
    res.assertStatus(200)
    res.assertBodyContains({ estado: 'resuelta', viajeEstado: 'cancelado' })

    const viaje = await db.from('viajes').where('id', tripId).first()
    assert.equal(viaje.estado, 'cancelado')
    assert.isNotNull(viaje.cancelado_at)
    assert.lengthOf(await db.from('ganancias').where('viaje_id', tripId), 0)

    const nuevo = await pedirViaje(client, cliente.token)
    nuevo.assertStatus(200)
  })
})
