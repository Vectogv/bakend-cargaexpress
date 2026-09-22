import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import testUtils from '@adonisjs/core/services/test_utils'
import ConfiguracionPlataforma from '#models/configuracion_plataforma'
import Conductor from '#models/conductor'
import User from '#models/user'
import { distanciaKm } from '#services/geo_service'

/**
 * Mapa del SOS: los endpoints de emergencias deben entregar las coordenadas del
 * viaje, la ubicación del conductor y las distancias del punto de pánico, sin
 * cambiar los campos de texto que ya consume el panel.
 */

const uniq = () => `${Date.now()}${Math.floor(Math.random() * 1e6)}`

const ZONA = 'popayan'
const ORIGEN = { direccion: 'Parque Caldas, Popayán', lat: 2.4419, lng: -76.6063 }
const DESTINO = { direccion: 'Terminal, Popayán', lat: 2.4569, lng: -76.5952 }
/** Punto intermedio: ahí se activa el SOS y ahí está el conductor. */
const SOS = { lat: 2.448, lng: -76.6 }

async function registrarCliente(client: any) {
  const res = await client.post('/api/auth/register').json({
    nombre: 'Cli',
    apellido: 'Mapa',
    email: `mapa_cli_${uniq()}@test.com`,
    password: 'Password123',
    rol: 'cliente',
    edad: 30,
    telefono: '3105550001',
  })
  res.assertStatus(200)
  return (res.body() as { token: string }).token
}

async function registrarAdmin(client: any) {
  const res = await client.post('/api/auth/register').json({
    nombre: 'Admin',
    apellido: 'Mapa',
    email: `mapa_admin_${uniq()}@test.com`,
    password: 'Password123',
    rol: 'cliente',
    edad: 35,
  })
  res.assertStatus(200)
  const body = res.body() as { token: string; id: string }
  await User.query().where('id', Number(body.id)).update({ rol: 'admin' })
  return body.token
}

/** El middleware de moderador exige zonaModerador: sin ciudad responde 403. */
async function registrarModerador(client: any) {
  const user = await User.create({
    nombre: 'Mod',
    apellido: 'Mapa',
    email: `mapa_mod_${uniq()}@test.com`,
    password: 'Password123',
    rol: 'moderador',
    esModerador: true,
    zonaModerador: ZONA,
  })
  const login = await client.post('/api/auth/login').json({ email: user.email, password: 'Password123' })
  login.assertStatus(200)
  return (login.body() as { token: string }).token
}

async function registrarConductor(client: any) {
  const res = await client.post('/api/auth/register').json({
    nombre: 'Con',
    apellido: 'Mapa',
    email: `mapa_con_${uniq()}@test.com`,
    password: 'Password123',
    rol: 'conductor',
    edad: 35,
    cedula: `${uniq()}`.slice(-9),
    placa: `MAP${`${uniq()}`.slice(-3)}`,
    tipoVehiculo: 'camioneta',
    capacidad: '1 tonelada',
    ciudad: ZONA,
  })
  res.assertStatus(200)
  const body = res.body() as { token: string; id: string }
  const conductor = await Conductor.findByOrFail('usuario_id', Number(body.id))
  conductor.estadoVerificacion = 'aprobado'
  conductor.ciudad = ZONA
  await conductor.save()
  return { token: body.token, conductorId: conductor.id }
}

/** La ubicación se escribe directo: el endpoint tiene límite de frecuencia. */
async function ubicar(conductorId: number, lat: number, lng: number) {
  const conductor = await Conductor.findOrFail(conductorId)
  conductor.ultimaUbicacionLat = lat
  conductor.ultimaUbicacionLng = lng
  conductor.ubicacionActualizadaEn = DateTime.now()
  await conductor.save()
}

/** Viaje con coordenadas reales, conductor asignado y SOS activado. */
async function viajeConSos(client: any, tokenCliente: string, driver: { token: string; conductorId: number }) {
  // El antifraude exige que el conductor esté cerca del origen para ofertar.
  await ubicar(driver.conductorId, ORIGEN.lat, ORIGEN.lng)

  const viaje = await client.post('/api/trips/request').bearerToken(tokenCliente).json({
    origen: ORIGEN,
    destino: DESTINO,
    descripcion: 'Trasteo pequeño',
    precioCliente: 80000,
  })
  viaje.assertStatus(200)
  const viajeId = (viaje.body() as { id: string }).id

  const oferta = await client.post(`/api/trips/${viajeId}/offers`).bearerToken(driver.token).json({ monto: 75000 })
  oferta.assertStatus(201)
  const ofertaId = (oferta.body() as { id: string }).id
  const acepta = await client.post(`/api/trips/${viajeId}/offers/${ofertaId}/accept`).bearerToken(tokenCliente)
  acepta.assertStatus(200)

  await ubicar(driver.conductorId, SOS.lat, SOS.lng)

  const sos = await client
    .post('/api/emergency')
    .bearerToken(driver.token)
    .json({ viajeId, lat: SOS.lat, lng: SOS.lng, motivo: 'Vehículo interceptado' })
  sos.assertStatus(201)

  return { viajeId, alertaId: (sos.body() as { id: number }).id }
}

function alertaDe(body: any, alertaId: number) {
  const lista = Array.isArray(body) ? body : []
  return lista.find((a: any) => Number(a.id) === Number(alertaId))
}

test.group('Emergencias con mapa del SOS', (group) => {
  // Transacción global: las alertas de prueba no deben filtrarse a otras suites
  // (/api/sos lista todas las alertas de la base).
  group.each.setup(async () => {
    const rollback = await testUtils.db().withGlobalTransaction()
    await ConfiguracionPlataforma.query().delete()
    return rollback
  })

  test('el admin recibe coordenadas del viaje, ubicación del conductor y distancias', async ({ client, assert }) => {
    const tokenCliente = await registrarCliente(client)
    const driver = await registrarConductor(client)
    const admin = await registrarAdmin(client)
    const { alertaId } = await viajeConSos(client, tokenCliente, driver)

    const res = await client.get('/api/admin/emergencies?limit=100').bearerToken(admin)
    res.assertStatus(200)

    const alerta = alertaDe(res.body(), alertaId)
    assert.isDefined(alerta, 'La alerta recién creada debe estar en la lista')

    // Campos existentes: siguen siendo el texto de la dirección.
    assert.isString(alerta.viaje.origen)
    assert.equal(alerta.viaje.origen, ORIGEN.direccion)
    assert.isString(alerta.viaje.destino)
    assert.equal(alerta.viaje.destino, DESTINO.direccion)

    // Campos nuevos.
    assert.closeTo(alerta.viaje.origenCoords.lat, ORIGEN.lat, 0.0001)
    assert.closeTo(alerta.viaje.origenCoords.lng, ORIGEN.lng, 0.0001)
    assert.closeTo(alerta.viaje.destinoCoords.lat, DESTINO.lat, 0.0001)
    assert.closeTo(alerta.viaje.destinoCoords.lng, DESTINO.lng, 0.0001)

    assert.closeTo(alerta.conductorUbicacion.lat, SOS.lat, 0.0001)
    assert.closeTo(alerta.conductorUbicacion.lng, SOS.lng, 0.0001)
    assert.isString(alerta.conductorUbicacion.actualizadaEn)

    const esperadoOrigen = Math.round(distanciaKm(ORIGEN.lat, ORIGEN.lng, SOS.lat, SOS.lng) * 10) / 10
    const esperadoDestino = Math.round(distanciaKm(SOS.lat, SOS.lng, DESTINO.lat, DESTINO.lng) * 10) / 10
    assert.equal(alerta.sos.distanciaOrigenKm, esperadoOrigen)
    assert.equal(alerta.sos.distanciaDestinoKm, esperadoDestino)
    assert.isAbove(alerta.sos.distanciaOrigenKm, 0)
    assert.isAbove(alerta.sos.distanciaDestinoKm, 0)

    // Coherencia: el SOS está entre origen y destino (desigualdad triangular).
    const ruta = distanciaKm(ORIGEN.lat, ORIGEN.lng, DESTINO.lat, DESTINO.lng)
    assert.isAtLeast(alerta.sos.distanciaOrigenKm + alerta.sos.distanciaDestinoKm, Math.round(ruta * 10) / 10)
    assert.isAbove(alerta.sos.avanceRuta, 0)
    assert.isAtMost(alerta.sos.avanceRuta, 1)
  })

  test('el moderador de la zona recibe los mismos datos del mapa', async ({ client, assert }) => {
    const tokenCliente = await registrarCliente(client)
    const driver = await registrarConductor(client)
    const moderador = await registrarModerador(client)
    const { alertaId } = await viajeConSos(client, tokenCliente, driver)

    const res = await client.get('/api/moderator/emergency?limit=100').bearerToken(moderador)
    res.assertStatus(200)

    const alerta = alertaDe(res.body(), alertaId)
    assert.isDefined(alerta, 'La alerta de la ciudad del moderador debe estar en la lista')

    // Campos existentes intactos + el texto que define el contrato.
    assert.equal(alerta.viaje.origenDireccion, ORIGEN.direccion)
    assert.equal(alerta.viaje.destinoDireccion, DESTINO.direccion)
    assert.isString(alerta.viaje.origen)
    assert.equal(alerta.viaje.origen, ORIGEN.direccion)
    assert.isString(alerta.viaje.destino)
    assert.equal(alerta.viaje.destino, DESTINO.direccion)

    assert.closeTo(alerta.viaje.origenCoords.lat, ORIGEN.lat, 0.0001)
    assert.closeTo(alerta.viaje.origenCoords.lng, ORIGEN.lng, 0.0001)
    assert.closeTo(alerta.viaje.destinoCoords.lat, DESTINO.lat, 0.0001)
    assert.closeTo(alerta.viaje.destinoCoords.lng, DESTINO.lng, 0.0001)

    assert.closeTo(alerta.conductorUbicacion.lat, SOS.lat, 0.0001)
    assert.closeTo(alerta.conductorUbicacion.lng, SOS.lng, 0.0001)
    assert.isString(alerta.conductorUbicacion.actualizadaEn)

    const esperadoOrigen = Math.round(distanciaKm(ORIGEN.lat, ORIGEN.lng, SOS.lat, SOS.lng) * 10) / 10
    const esperadoDestino = Math.round(distanciaKm(SOS.lat, SOS.lng, DESTINO.lat, DESTINO.lng) * 10) / 10
    assert.equal(alerta.sos.distanciaOrigenKm, esperadoOrigen)
    assert.equal(alerta.sos.distanciaDestinoKm, esperadoDestino)
    assert.isAbove(alerta.sos.avanceRuta, 0)
    assert.isAtMost(alerta.sos.avanceRuta, 1)
  })

  test('sin coordenadas del SOS las distancias quedan en null', async ({ client, assert }) => {
    const tokenCliente = await registrarCliente(client)
    const driver = await registrarConductor(client)
    const admin = await registrarAdmin(client)
    await ubicar(driver.conductorId, ORIGEN.lat, ORIGEN.lng)

    const viaje = await client.post('/api/trips/request').bearerToken(tokenCliente).json({
      origen: ORIGEN,
      destino: DESTINO,
      descripcion: 'Trasteo pequeño',
      precioCliente: 80000,
    })
    viaje.assertStatus(200)
    const viajeId = (viaje.body() as { id: string }).id

    const oferta = await client.post(`/api/trips/${viajeId}/offers`).bearerToken(driver.token).json({ monto: 75000 })
    const ofertaId = (oferta.body() as { id: string }).id
    await client.post(`/api/trips/${viajeId}/offers/${ofertaId}/accept`).bearerToken(tokenCliente)

    // Conductor sin ubicación conocida y SOS sin coordenadas: ambos campos en null.
    const conductor = await Conductor.findOrFail(driver.conductorId)
    conductor.ultimaUbicacionLat = null
    conductor.ultimaUbicacionLng = null
    conductor.ubicacionActualizadaEn = null
    await conductor.save()

    const sos = await client.post('/api/emergency').bearerToken(driver.token).json({ viajeId })
    sos.assertStatus(201)
    const alertaId = (sos.body() as { id: number }).id

    const res = await client.get('/api/admin/emergencies?limit=100').bearerToken(admin)
    const alerta = alertaDe(res.body(), alertaId)
    assert.isDefined(alerta)
    assert.isNull(alerta.sos)
    assert.isNull(alerta.conductorUbicacion)
    assert.isNotNull(alerta.viaje.origenCoords)
  })
})
