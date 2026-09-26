import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import { io } from 'socket.io-client'
import { setTimeout as delay } from 'node:timers/promises'
import Conductor from '#models/conductor'
import Viaje from '#models/viaje'
import User from '#models/user'

/**
 * Los reportes de conductores contra un cliente NUNCA suspenden la cuenta
 * automáticamente (queda en manos del admin con PUT /admin/users/:id/suspend).
 * Sigue contando `totalReportes`; desde el 2º reporte la visibilidad queda
 * 'reducida' (no 'baneado') y se avisa a los admins con `requiereRevision`.
 */

const SOCKET_URL = `http://localhost:${process.env.PORT ?? 3333}`
const uniq = () => `${Date.now()}${Math.floor(Math.random() * 1e6)}`

async function registrarCliente(client: any) {
  const res = await client.post('/api/auth/register').json({
    nombre: 'Cli',
    apellido: 'Reportado',
    email: `reportado_${uniq()}@test.com`,
    password: 'Password123',
    rol: 'cliente',
    edad: 30,
  })
  res.assertStatus(200)
  return res.body().id as number
}

async function registrarConductor(client: any) {
  const res = await client.post('/api/auth/register').json({
    nombre: 'Con',
    apellido: 'Reporta',
    email: `reporta_${uniq()}@test.com`,
    password: 'Password123',
    rol: 'conductor',
    edad: 35,
    cedula: `${uniq()}`.slice(-10),
    placa: `REP${`${uniq()}`.slice(-4)}`,
    tipoVehiculo: 'camioneta',
    capacidad: '1 tonelada',
    ciudad: 'popayan',
  })
  res.assertStatus(200)
  const conductor = await Conductor.findByOrFail('usuario_id', Number(res.body().id))
  return { token: res.body().token as string, conductorId: conductor.id }
}

async function adminToken(client: any) {
  const id = await registrarCliente(client)
  await User.query().where('id', id).update({ rol: 'admin' })
  const login = await client
    .post('/api/auth/login')
    .json({ email: (await User.findOrFail(id)).email, password: 'Password123' })
  return login.body().token as string
}

async function crearViaje(clienteId: number, conductorId: number, estado = 'finalizado') {
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

test.group('Reportes de conductores contra clientes', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('el primer reporte baja reputación y visibilidad, sin suspender', async ({
    client,
    assert,
  }) => {
    const clienteId = await registrarCliente(client)
    const { token, conductorId } = await registrarConductor(client)
    const viaje = await crearViaje(clienteId, conductorId)

    const res = await client
      .post(`/api/trips/${viaje.id}/report`)
      .bearerToken(token)
      .json({ motivo: 'otro', descripcion: 'primer reporte' })
    res.assertStatus(201)

    const cliente = await User.findOrFail(clienteId)
    assert.equal(cliente.totalReportes, 1)
    assert.equal(Number(cliente.reputacion), 3.0)
    assert.equal(cliente.visibilidad, 'reducida')
    assert.isFalse(Boolean(cliente.suspendido))
  })

  test('el segundo reporte no banea ni suspende: queda reducida y marcada para revisión', async ({
    client,
    assert,
  }) => {
    const clienteId = await registrarCliente(client)
    const { token, conductorId } = await registrarConductor(client)
    const viaje1 = await crearViaje(clienteId, conductorId)
    const viaje2 = await crearViaje(clienteId, conductorId)

    const primero = await client
      .post(`/api/trips/${viaje1.id}/report`)
      .bearerToken(token)
      .json({ motivo: 'otro' })
    primero.assertStatus(201)

    const segundo = await client
      .post(`/api/trips/${viaje2.id}/report`)
      .bearerToken(token)
      .json({ motivo: 'comportamiento' })
    segundo.assertStatus(201)

    const cliente = await User.findOrFail(clienteId)
    assert.equal(cliente.totalReportes, 2)
    assert.equal(Number(cliente.reputacion), 1.0)
    assert.equal(cliente.visibilidad, 'reducida')
    assert.notEqual(cliente.visibilidad, 'baneado')
    assert.isFalse(Boolean(cliente.suspendido))
  })

  test('el admin recibe report:new con requiereRevision solo desde el 2º reporte', async ({
    client,
    assert,
  }) => {
    const clienteId = await registrarCliente(client)
    const { token, conductorId } = await registrarConductor(client)
    const viaje1 = await crearViaje(clienteId, conductorId)
    const viaje2 = await crearViaje(clienteId, conductorId)
    const admin = await adminToken(client)

    const eventos: any[] = []
    const socket = io(SOCKET_URL, { query: { token: admin } })
    socket.on('report:new', (payload: any) => eventos.push(payload))
    await new Promise<void>((resolve) => socket.on('connect', () => resolve()))
    await delay(300)

    const primero = await client
      .post(`/api/trips/${viaje1.id}/report`)
      .bearerToken(token)
      .json({ motivo: 'otro' })
    primero.assertStatus(201)
    await delay(300)

    const segundo = await client
      .post(`/api/trips/${viaje2.id}/report`)
      .bearerToken(token)
      .json({ motivo: 'comportamiento' })
    segundo.assertStatus(201)
    await delay(300)

    socket.disconnect()

    assert.lengthOf(eventos, 2)
    assert.isFalse(Boolean(eventos[0].requiereRevision))
    assert.isTrue(eventos[1].requiereRevision)
  }).timeout(10000)
})
