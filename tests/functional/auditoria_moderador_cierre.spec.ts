import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import ConfiguracionPlataforma from '#models/configuracion_plataforma'
import User from '#models/user'

/**
 * Auditoría:
 *  • IMPORTANTE #4: el moderador no puede resolver un cierre pendiente antes
 *    de que venza el plazo de confirmación del cliente.
 *  • IMPORTANTE #8: la zona del moderador coincide con la ciudad del
 *    conductor aunque ésta tenga tildes o mayúsculas ('Popayán' = 'popayan').
 */

const uniq = () => `${Date.now()}${Math.floor(Math.random() * 1e6)}`
const ORIGEN = { direccion: 'Origen mod', lat: 2.4419, lng: -76.6063 }
const DESTINO = { direccion: 'Destino mod', lat: 2.4569, lng: -76.5952 }
const NOTA = 'El cliente no respondió el cierre indicado.'

async function registrarCliente(client: any) {
  const res = await client.post('/api/auth/register').json({
    nombre: 'Cli',
    apellido: 'Mod',
    email: `modc_cli_${uniq()}@test.com`,
    password: 'Password123',
    rol: 'cliente',
    edad: 30,
  })
  res.assertStatus(200)
  return res.body().token as string
}

async function registrarConductor(client: any, ciudad: string) {
  const res = await client.post('/api/auth/register').json({
    nombre: 'Con',
    apellido: 'Mod',
    email: `modc_con_${uniq()}@test.com`,
    password: 'Password123',
    rol: 'conductor',
    edad: 35,
    cedula: `${uniq()}`.slice(-10),
    placa: `MOD${`${uniq()}`.slice(-5)}`,
    tipoVehiculo: 'camioneta',
    capacidad: '1 tonelada',
    ciudad,
  })
  res.assertStatus(200)
  const userId = Number(res.body().id)
  await db.from('conductores').where('usuario_id', userId).update({ estado_verificacion: 'aprobado', ciudad })
  const conductor = await db.from('conductores').where('usuario_id', userId).first()
  return { token: res.body().token as string, conductorId: Number(conductor.id) }
}

async function ubicar(conductorId: number, lat: number, lng: number) {
  await db.from('conductores').where('id', conductorId).update({
    ultima_ubicacion_lat: lat,
    ultima_ubicacion_lng: lng,
    ubicacion_actualizada_en: DateTime.now().toSQL(),
  })
}

async function crearModerador(client: any, zona: string) {
  const user = await User.create({
    nombre: 'Mod',
    apellido: 'Cierre',
    email: `modc_mod_${uniq()}@test.com`,
    password: 'Password123',
    rol: 'moderador',
    esModerador: true,
    zonaModerador: zona,
  })
  const login = await client.post('/api/auth/login').json({ email: user.email, password: 'Password123' })
  login.assertStatus(200)
  return login.body().token as string
}

async function viajePendienteConfirmacion(client: any, ciudadConductor: string) {
  const tokenCliente = await registrarCliente(client)
  const driver = await registrarConductor(client, ciudadConductor)
  const viaje = await client.post('/api/trips/request').bearerToken(tokenCliente).json({
    origen: ORIGEN,
    destino: DESTINO,
    descripcion: 'Carga moderador',
    precioCliente: 45000,
  })
  viaje.assertStatus(200)
  const tripId = Number(viaje.body().id)
  ;(await client.post(`/api/trips/${tripId}/accept`).bearerToken(driver.token)).assertStatus(200)
  await ubicar(driver.conductorId, ORIGEN.lat, ORIGEN.lng)
  ;(await client.post(`/api/trips/${tripId}/start-trip`).bearerToken(driver.token)).assertStatus(200)
  await ubicar(driver.conductorId, DESTINO.lat, DESTINO.lng)
  ;(
    await client.post(`/api/trips/${tripId}/complete`).bearerToken(driver.token).json({ montoFinal: 45000 })
  ).assertStatus(200)
  return tripId
}

async function vencerPlazo(tripId: number) {
  await db.from('viajes').where('id', tripId).update({
    pendiente_confirmacion_desde: DateTime.now().minus({ minutes: 20 }).toFormat('yyyy-MM-dd HH:mm:ss'),
  })
}

test.group('Auditoría #4/#8 - moderador resuelve cierres pendientes', (group) => {
  group.each.setup(async () => {
    await ConfiguracionPlataforma.query().delete()
  })

  test('no se puede resolver antes de que venza el plazo del cliente', async ({ client, assert }) => {
    const tripId = await viajePendienteConfirmacion(client, 'popayan')
    const moderador = await crearModerador(client, 'popayan')

    const temprano = await client
      .post(`/api/moderator/trips/${tripId}/resolve-close`)
      .bearerToken(moderador)
      .json({ resolucion: 'finalizar', nota: NOTA })
    temprano.assertStatus(409)
    temprano.assertBodyContains({ code: 'CONFIRMACION_EN_PLAZO' })

    const viaje = await db.from('viajes').where('id', tripId).first()
    assert.equal(viaje.estado, 'pendiente_confirmacion')
    assert.lengthOf(await db.from('ganancias').where('viaje_id', tripId), 0)

    await vencerPlazo(tripId)
    const vencido = await client
      .post(`/api/moderator/trips/${tripId}/resolve-close`)
      .bearerToken(moderador)
      .json({ resolucion: 'finalizar', nota: NOTA })
    vencido.assertStatus(200)
    vencido.assertBodyContains({ estado: 'finalizado' })
  })

  test('la ciudad del conductor con tilde y mayúsculas coincide con la zona', async ({ client }) => {
    const tripId = await viajePendienteConfirmacion(client, 'Popayán ')
    const moderador = await crearModerador(client, 'popayan')
    await vencerPlazo(tripId)

    const res = await client
      .post(`/api/moderator/trips/${tripId}/resolve-close`)
      .bearerToken(moderador)
      .json({ resolucion: 'finalizar', nota: NOTA })
    res.assertStatus(200)
    res.assertBodyContains({ estado: 'finalizado' })
  })
})
