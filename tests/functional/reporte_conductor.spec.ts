import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import { io } from 'socket.io-client'
import { setTimeout as delay } from 'node:timers/promises'
import Conductor from '#models/conductor'
import Reporte from '#models/reporte'
import Viaje from '#models/viaje'
import User from '#models/user'

/**
 * El cliente dueño del viaje reporta al conductor asignado con el mismo
 * endpoint que usa el conductor (POST /api/trips/:id/report). Mismas reglas:
 * nunca suspende, baja reputación (−2 el 1º, 1.0 desde el 2º), visibilidad
 * 'reducida' y `requiereRevision` al admin desde el 2º reporte. Se penaliza
 * el User del conductor, que es donde vive su reputación.
 */

const SOCKET_URL = `http://localhost:${process.env.PORT ?? 3333}`
const uniq = () => `${Date.now()}${Math.floor(Math.random() * 1e6)}`

async function registrarCliente(client: any) {
  const res = await client.post('/api/auth/register').json({
    nombre: 'Cli',
    apellido: 'Reporta',
    email: `cli_reporta_${uniq()}@test.com`,
    password: 'Password123',
    rol: 'cliente',
    edad: 30,
  })
  res.assertStatus(200)
  return { id: res.body().id as number, token: res.body().token as string }
}

async function registrarConductor(client: any) {
  const res = await client.post('/api/auth/register').json({
    nombre: 'Con',
    apellido: 'Reportado',
    email: `con_reportado_${uniq()}@test.com`,
    password: 'Password123',
    rol: 'conductor',
    edad: 35,
    cedula: `${uniq()}`.slice(-10),
    placa: `RCO${`${uniq()}`.slice(-4)}`,
    tipoVehiculo: 'camioneta',
    capacidad: '1 tonelada',
    ciudad: 'popayan',
  })
  res.assertStatus(200)
  const usuarioId = Number(res.body().id)
  const conductor = await Conductor.findByOrFail('usuario_id', usuarioId)
  return { token: res.body().token as string, conductorId: conductor.id, usuarioId }
}

async function adminToken(client: any) {
  const { id } = await registrarCliente(client)
  await User.query().where('id', id).update({ rol: 'admin' })
  const login = await client
    .post('/api/auth/login')
    .json({ email: (await User.findOrFail(id)).email, password: 'Password123' })
  return login.body().token as string
}

async function crearViaje(clienteId: number, conductorId: number | null, estado = 'finalizado') {
  return Viaje.create({
    clienteId,
    conductorId,
    estado,
    origenDireccion: 'Parque Caldas, Popayán',
    origenLat: 2.4419,
    origenLng: -76.6063,
    destinoDireccion: 'Terminal, Popayán',
    destinoLat: 2.4569,
    destinoLng: -76.5952,
    precioCliente: 50000,
    precioEstimado: 50000,
  } as any)
}

test.group('Reportes de clientes contra conductores', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('el primer reporte baja reputación y visibilidad del conductor, sin suspender', async ({
    client,
    assert,
  }) => {
    const cliente = await registrarCliente(client)
    const { conductorId, usuarioId } = await registrarConductor(client)
    const viaje = await crearViaje(cliente.id, conductorId)

    const res = await client
      .post(`/api/trips/${viaje.id}/report`)
      .bearerToken(cliente.token)
      .json({ motivo: 'comportamiento', descripcion: 'fue grosero' })
    res.assertStatus(201)
    assert.equal(res.body().estado, 'pendiente')
    assert.equal(res.body().motivo, 'comportamiento')
    assert.equal(res.body().reportadoPor, 'cliente')

    const reporte = await Reporte.findOrFail(Number(res.body().id))
    assert.equal(reporte.reportadoPor, 'cliente')
    assert.equal(reporte.conductorId, conductorId)
    assert.equal(reporte.clienteId, cliente.id)
    assert.equal(reporte.descripcion, 'fue grosero')

    const conductorUser = await User.findOrFail(usuarioId)
    assert.equal(conductorUser.totalReportes, 1)
    assert.equal(Number(conductorUser.reputacion), 3.0)
    assert.equal(conductorUser.visibilidad, 'reducida')
    assert.isFalse(Boolean(conductorUser.suspendido))

    // El cliente que reporta no se ve afectado.
    const clienteUser = await User.findOrFail(cliente.id)
    assert.equal(clienteUser.totalReportes, 0)
    assert.equal(Number(clienteUser.reputacion), 5.0)
  })

  test('el segundo reporte deja la reputación en 1.0 y reducida, sin banear ni suspender', async ({
    client,
    assert,
  }) => {
    const cliente1 = await registrarCliente(client)
    const cliente2 = await registrarCliente(client)
    const { conductorId, usuarioId } = await registrarConductor(client)
    const viaje1 = await crearViaje(cliente1.id, conductorId)
    const viaje2 = await crearViaje(cliente2.id, conductorId)

    const primero = await client
      .post(`/api/trips/${viaje1.id}/report`)
      .bearerToken(cliente1.token)
      .json({ motivo: 'otro' })
    primero.assertStatus(201)

    const segundo = await client
      .post(`/api/trips/${viaje2.id}/report`)
      .bearerToken(cliente2.token)
      .json({ motivo: 'no_se_presento' })
    segundo.assertStatus(201)

    const conductorUser = await User.findOrFail(usuarioId)
    assert.equal(conductorUser.totalReportes, 2)
    assert.equal(Number(conductorUser.reputacion), 1.0)
    assert.equal(conductorUser.visibilidad, 'reducida')
    assert.notEqual(conductorUser.visibilidad, 'baneado')
    assert.isFalse(Boolean(conductorUser.suspendido))
  })

  test('no se puede reportar dos veces al conductor del mismo viaje (409)', async ({
    client,
    assert,
  }) => {
    const cliente = await registrarCliente(client)
    const { conductorId, usuarioId } = await registrarConductor(client)
    const viaje = await crearViaje(cliente.id, conductorId)

    const primero = await client
      .post(`/api/trips/${viaje.id}/report`)
      .bearerToken(cliente.token)
      .json({ motivo: 'otro' })
    primero.assertStatus(201)

    const repetido = await client
      .post(`/api/trips/${viaje.id}/report`)
      .bearerToken(cliente.token)
      .json({ motivo: 'comportamiento' })
    repetido.assertStatus(409)
    assert.equal(repetido.body().error, 'Ya reportaste al conductor de este viaje')

    const conductorUser = await User.findOrFail(usuarioId)
    assert.equal(conductorUser.totalReportes, 1)
  })

  test('solo el cliente dueño del viaje puede reportar (403)', async ({ client }) => {
    const dueno = await registrarCliente(client)
    const otro = await registrarCliente(client)
    const { conductorId } = await registrarConductor(client)
    const viaje = await crearViaje(dueno.id, conductorId)

    const res = await client
      .post(`/api/trips/${viaje.id}/report`)
      .bearerToken(otro.token)
      .json({ motivo: 'otro' })
    res.assertStatus(403)
  })

  test('sin conductor asignado no hay a quién reportar (422)', async ({ client, assert }) => {
    const cliente = await registrarCliente(client)
    const viaje = await crearViaje(cliente.id, null, 'buscando_conductor')

    const res = await client
      .post(`/api/trips/${viaje.id}/report`)
      .bearerToken(cliente.token)
      .json({ motivo: 'otro' })
    res.assertStatus(422)
    assert.equal(res.body().error, 'El viaje no tuvo conductor asignado')
  })

  test('el motivo se valida contra la lista del cliente (422)', async ({ client, assert }) => {
    const cliente = await registrarCliente(client)
    const { conductorId, usuarioId } = await registrarConductor(client)
    const viaje = await crearViaje(cliente.id, conductorId)

    const sinMotivo = await client
      .post(`/api/trips/${viaje.id}/report`)
      .bearerToken(cliente.token)
      .json({ descripcion: 'sin motivo' })
    sinMotivo.assertStatus(422)

    // 'no_pago' es un motivo del conductor, no del cliente.
    const motivoAjeno = await client
      .post(`/api/trips/${viaje.id}/report`)
      .bearerToken(cliente.token)
      .json({ motivo: 'no_pago' })
    motivoAjeno.assertStatus(422)

    const conductorUser = await User.findOrFail(usuarioId)
    assert.equal(conductorUser.totalReportes, 0)
    assert.equal(Number(conductorUser.reputacion), 5.0)
  })

  test('viaje inexistente responde 404', async ({ client }) => {
    const cliente = await registrarCliente(client)
    const res = await client
      .post('/api/trips/999999999/report')
      .bearerToken(cliente.token)
      .json({ motivo: 'otro' })
    res.assertStatus(404)
  })

  test('el reporte del cliente no bloquea el del conductor en el mismo viaje', async ({
    client,
    assert,
  }) => {
    const cliente = await registrarCliente(client)
    const conductor = await registrarConductor(client)
    const viaje = await crearViaje(cliente.id, conductor.conductorId)

    const delCliente = await client
      .post(`/api/trips/${viaje.id}/report`)
      .bearerToken(cliente.token)
      .json({ motivo: 'cobro_incorrecto' })
    delCliente.assertStatus(201)

    const delConductor = await client
      .post(`/api/trips/${viaje.id}/report`)
      .bearerToken(conductor.token)
      .json({ motivo: 'no_pago' })
    delConductor.assertStatus(201)
    assert.equal(delConductor.body().reportadoPor, 'conductor')

    const reportes = await Reporte.query().where('viaje_id', viaje.id)
    assert.lengthOf(reportes, 2)

    // Cada uno penaliza solo al reportado.
    const clienteUser = await User.findOrFail(cliente.id)
    const conductorUser = await User.findOrFail(conductor.usuarioId)
    assert.equal(clienteUser.totalReportes, 1)
    assert.equal(conductorUser.totalReportes, 1)
  })

  test('el admin recibe report:new con reportadoPor=cliente y requiereRevision desde el 2º', async ({
    client,
    assert,
  }) => {
    const cliente1 = await registrarCliente(client)
    const cliente2 = await registrarCliente(client)
    const { conductorId } = await registrarConductor(client)
    const viaje1 = await crearViaje(cliente1.id, conductorId)
    const viaje2 = await crearViaje(cliente2.id, conductorId)
    const admin = await adminToken(client)

    const eventos: any[] = []
    const socket = io(SOCKET_URL, { query: { token: admin } })
    socket.on('report:new', (payload: any) => eventos.push(payload))
    await new Promise<void>((resolve) => socket.on('connect', () => resolve()))
    await delay(300)

    const primero = await client
      .post(`/api/trips/${viaje1.id}/report`)
      .bearerToken(cliente1.token)
      .json({ motivo: 'otro' })
    primero.assertStatus(201)
    await delay(300)

    const segundo = await client
      .post(`/api/trips/${viaje2.id}/report`)
      .bearerToken(cliente2.token)
      .json({ motivo: 'comportamiento' })
    segundo.assertStatus(201)
    await delay(300)

    socket.disconnect()

    assert.lengthOf(eventos, 2)
    assert.equal(eventos[0].reportadoPor, 'cliente')
    assert.isFalse(Boolean(eventos[0].requiereRevision))
    assert.isTrue(eventos[1].requiereRevision)
  }).timeout(10000)
})
