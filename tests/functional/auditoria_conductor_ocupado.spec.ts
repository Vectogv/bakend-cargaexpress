import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import ConfiguracionPlataforma from '#models/configuracion_plataforma'
import Conductor from '#models/conductor'
import Viaje from '#models/viaje'
import TripDispatchService from '#services/trip_dispatch_service'

/**
 * Auditoría CRÍTICO #1: un conductor no puede quedar asignado a dos viajes
 * inmediatos activos al mismo tiempo (un conductor = un servicio a la vez).
 */

const uniq = () => `${Date.now()}${Math.floor(Math.random() * 1e6)}`

const ORIGEN = { direccion: 'Parque Caldas, Popayán', lat: 2.4419, lng: -76.6063 }
const DESTINO = { direccion: 'Terminal, Popayán', lat: 2.4569, lng: -76.5952 }

async function registrarCliente(client: any) {
  const res = await client.post('/api/auth/register').json({
    nombre: 'Cli',
    apellido: 'Ocupado',
    email: `ocupado_cli_${uniq()}@test.com`,
    password: 'Password123',
    rol: 'cliente',
    edad: 30,
  })
  res.assertStatus(200)
  return res.body().token as string
}

async function registrarConductor(client: any) {
  const res = await client.post('/api/auth/register').json({
    nombre: 'Con',
    apellido: 'Ocupado',
    email: `ocupado_con_${uniq()}@test.com`,
    password: 'Password123',
    rol: 'conductor',
    edad: 35,
    cedula: `${uniq()}`.slice(-10),
    placa: `OCU${`${uniq()}`.slice(-5)}`,
    tipoVehiculo: 'camioneta',
    capacidad: '1 tonelada',
    ciudad: 'popayan',
  })
  res.assertStatus(200)
  const conductor = await Conductor.findByOrFail('usuario_id', Number(res.body().id))
  conductor.estadoVerificacion = 'aprobado'
  await conductor.save()
  return { token: res.body().token as string, conductorId: conductor.id }
}

async function ubicar(conductorId: number, lat: number, lng: number) {
  await db.from('conductores').where('id', conductorId).update({
    ultima_ubicacion_lat: lat,
    ultima_ubicacion_lng: lng,
    online: true,
    ubicacion_actualizada_en: DateTime.now().toSQL(),
  })
}

async function pedirViaje(client: any, token: string) {
  const res = await client.post('/api/trips/request').bearerToken(token).json({
    origen: ORIGEN,
    destino: DESTINO,
    descripcion: 'Carga auditoría',
    precioCliente: 60000,
  })
  res.assertStatus(200)
  return res.body().id as string
}

async function ofertar(client: any, token: string, viajeId: string) {
  return client.post(`/api/trips/${viajeId}/offers`).bearerToken(token).json({ monto: 55000 })
}

test.group('Auditoría #1 - conductor ocupado', (group) => {
  group.each.setup(async () => {
    await ConfiguracionPlataforma.query().delete()
  })

  test('el cliente no puede aceptar la oferta de un conductor que ya tiene otro viaje activo', async ({
    client,
    assert,
  }) => {
    const tokenA = await registrarCliente(client)
    const tokenB = await registrarCliente(client)
    const driver = await registrarConductor(client)
    await ubicar(driver.conductorId, ORIGEN.lat, ORIGEN.lng)

    const viajeA = await pedirViaje(client, tokenA)
    const viajeB = await pedirViaje(client, tokenB)

    // El conductor oferta en ambos antes de que ninguno lo acepte.
    const ofertaA = await ofertar(client, driver.token, viajeA)
    ofertaA.assertStatus(201)
    const ofertaB = await ofertar(client, driver.token, viajeB)
    ofertaB.assertStatus(201)

    const aceptaA = await client
      .post(`/api/trips/${viajeA}/offers/${ofertaA.body().id}/accept`)
      .bearerToken(tokenA)
    aceptaA.assertStatus(200)

    const aceptaB = await client
      .post(`/api/trips/${viajeB}/offers/${ofertaB.body().id}/accept`)
      .bearerToken(tokenB)
    aceptaB.assertStatus(409)
    aceptaB.assertBodyContains({ code: 'CONDUCTOR_OCUPADO' })

    const b = await Viaje.findOrFail(Number(viajeB))
    assert.isNull(b.conductorId)
    assert.equal(b.estado, 'pendiente')
  })

  test('dos aceptaciones simultáneas del mismo conductor: solo una gana', async ({ client, assert }) => {
    const tokenA = await registrarCliente(client)
    const tokenB = await registrarCliente(client)
    const driver = await registrarConductor(client)
    await ubicar(driver.conductorId, ORIGEN.lat, ORIGEN.lng)

    const viajeA = await pedirViaje(client, tokenA)
    const viajeB = await pedirViaje(client, tokenB)
    const ofertaA = await ofertar(client, driver.token, viajeA)
    const ofertaB = await ofertar(client, driver.token, viajeB)

    const [ra, rb] = await Promise.all([
      client.post(`/api/trips/${viajeA}/offers/${ofertaA.body().id}/accept`).bearerToken(tokenA),
      client.post(`/api/trips/${viajeB}/offers/${ofertaB.body().id}/accept`).bearerToken(tokenB),
    ])
    const estados = [ra.status(), rb.status()].sort()
    assert.deepEqual(estados, [200, 409])

    const activos = await Viaje.query()
      .where('conductor_id', driver.conductorId)
      .where('estado', 'aceptado')
    assert.lengthOf(activos, 1)
  })

  test('un conductor ocupado no puede ofertar en otro viaje inmediato', async ({ client }) => {
    const tokenA = await registrarCliente(client)
    const tokenB = await registrarCliente(client)
    const driver = await registrarConductor(client)
    await ubicar(driver.conductorId, ORIGEN.lat, ORIGEN.lng)

    const viajeA = await pedirViaje(client, tokenA)
    const ofertaA = await ofertar(client, driver.token, viajeA)
    await client.post(`/api/trips/${viajeA}/offers/${ofertaA.body().id}/accept`).bearerToken(tokenA)

    const viajeB = await pedirViaje(client, tokenB)
    const ofertaB = await ofertar(client, driver.token, viajeB)
    ofertaB.assertStatus(409)
    ofertaB.assertBodyContains({ code: 'CONDUCTOR_OCUPADO' })
  })

  test('tras cerrar el servicio (pendiente de confirmación) puede volver a ofertar', async ({
    client,
  }) => {
    const tokenA = await registrarCliente(client)
    const tokenB = await registrarCliente(client)
    const driver = await registrarConductor(client)
    await ubicar(driver.conductorId, ORIGEN.lat, ORIGEN.lng)

    const viajeA = await pedirViaje(client, tokenA)
    const ofertaA = await ofertar(client, driver.token, viajeA)
    await client.post(`/api/trips/${viajeA}/offers/${ofertaA.body().id}/accept`).bearerToken(tokenA)
    await Viaje.query().where('id', Number(viajeA)).update({ estado: 'pendiente_confirmacion' })

    const viajeB = await pedirViaje(client, tokenB)
    const ofertaB = await ofertar(client, driver.token, viajeB)
    ofertaB.assertStatus(201)
  })

  test('aceptación legada: el conductor no puede tomar un segundo viaje activo', async ({ client }) => {
    const tokenA = await registrarCliente(client)
    const tokenB = await registrarCliente(client)
    const driver = await registrarConductor(client)
    await ubicar(driver.conductorId, ORIGEN.lat, ORIGEN.lng)

    const viajeA = await pedirViaje(client, tokenA)
    const viajeB = await pedirViaje(client, tokenB)

    const a = await client.post(`/api/trips/${viajeA}/accept`).bearerToken(driver.token)
    a.assertStatus(200)
    const b = await client.post(`/api/trips/${viajeB}/accept`).bearerToken(driver.token)
    b.assertStatus(409)
    b.assertBodyContains({ code: 'CONDUCTOR_OCUPADO' })
  })

  test('el despacho no notifica a conductores con un viaje activo', async ({ client, assert }) => {
    // Coordenadas aisladas para no mezclar conductores de otros tests.
    const lugar = { lat: 5.1, lng: -74.1 }
    const libre = await registrarConductor(client)
    const ocupado = await registrarConductor(client)
    await ubicar(libre.conductorId, lugar.lat, lugar.lng)
    await ubicar(ocupado.conductorId, lugar.lat, lugar.lng)

    const cli = await client.post('/api/auth/register').json({
      nombre: 'Cli',
      apellido: 'Despacho',
      email: `ocupado_desp_${uniq()}@test.com`,
      password: 'Password123',
      rol: 'cliente',
      edad: 30,
    })
    const cliente = Number(cli.body().id)
    const base = {
      origenDireccion: 'Aislado',
      origenLat: lugar.lat,
      origenLng: lugar.lng,
      destinoDireccion: 'Aislado 2',
      destinoLat: lugar.lat + 0.01,
      destinoLng: lugar.lng,
      precioCliente: 10000,
      precioEstimado: 10000,
    }
    await Viaje.create({ ...base, clienteId: cliente, estado: 'en_curso', conductorId: ocupado.conductorId })
    const nuevo = await Viaje.create({ ...base, clienteId: cliente, estado: 'buscando_conductor' })

    const notificados = await TripDispatchService.buscarConductores(nuevo)
    assert.equal(notificados, 1)
  })
})
