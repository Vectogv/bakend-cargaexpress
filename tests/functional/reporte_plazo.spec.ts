import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import { DateTime } from 'luxon'
import Conductor from '#models/conductor'
import Viaje from '#models/viaje'
import { REPORTE_PLAZO_MIN } from '#controllers/report_controller'

/**
 * POST /api/trips/:id/report: solo el conductor del viaje, solo con el viaje
 * finalizado y dentro de REPORTE_PLAZO_MIN minutos desde el cierre.
 */

const uniq = () => `${Date.now()}${Math.floor(Math.random() * 1e6)}`

async function registrarCliente(client: any) {
  const res = await client.post('/api/auth/register').json({
    nombre: 'Cli',
    apellido: 'Plazo',
    email: `cli_plazo_${uniq()}@test.com`,
    password: 'Password123',
    rol: 'cliente',
    edad: 30,
  })
  res.assertStatus(200)
  return { id: Number(res.body().id), token: res.body().token as string }
}

async function registrarConductor(client: any) {
  const res = await client.post('/api/auth/register').json({
    nombre: 'Con',
    apellido: 'Plazo',
    email: `con_plazo_${uniq()}@test.com`,
    password: 'Password123',
    rol: 'conductor',
    edad: 35,
    cedula: `${uniq()}`.slice(-10),
    placa: `RPL${`${uniq()}`.slice(-4)}`,
    tipoVehiculo: 'camioneta',
    capacidad: '1 tonelada',
    ciudad: 'popayan',
  })
  res.assertStatus(200)
  const conductor = await Conductor.findByOrFail('usuario_id', Number(res.body().id))
  return { token: res.body().token as string, conductorId: conductor.id }
}

async function crearViaje(
  clienteId: number,
  conductorId: number,
  extra: Partial<{ estado: string; finalizadoAt: DateTime; completadoAt: DateTime }> = {}
) {
  return Viaje.create({
    clienteId,
    conductorId,
    estado: 'finalizado',
    origenDireccion: 'Parque Caldas, Popayán',
    origenLat: 2.4419,
    origenLng: -76.6063,
    destinoDireccion: 'Terminal, Popayán',
    destinoLat: 2.4569,
    destinoLng: -76.5952,
    precioCliente: 50000,
    precioEstimado: 50000,
    ...extra,
  } as any)
}

test.group('Reporte de viaje: solo el conductor y con plazo', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('el cliente ya no puede reportar (403)', async ({ client }) => {
    const cliente = await registrarCliente(client)
    const { conductorId } = await registrarConductor(client)
    const viaje = await crearViaje(cliente.id, conductorId)

    const res = await client
      .post(`/api/trips/${viaje.id}/report`)
      .bearerToken(cliente.token)
      .json({ motivo: 'comportamiento' })
    res.assertStatus(403)
    res.assertBodyContains({ message: 'Solo el conductor puede reportar el viaje' })
  })

  test('viaje sin finalizar: 422', async ({ client }) => {
    const cliente = await registrarCliente(client)
    const { conductorId, token } = await registrarConductor(client)
    const viaje = await crearViaje(cliente.id, conductorId, { estado: 'en_curso' })

    const res = await client
      .post(`/api/trips/${viaje.id}/report`)
      .bearerToken(token)
      .json({ motivo: 'no_pago' })
    res.assertStatus(422)
  })

  test('dentro del plazo 201, fuera del plazo 422', async ({ client }) => {
    const cliente = await registrarCliente(client)
    const { conductorId, token } = await registrarConductor(client)

    const reciente = await crearViaje(cliente.id, conductorId, {
      finalizadoAt: DateTime.now().minus({ minutes: REPORTE_PLAZO_MIN - 1 }),
    })
    const ok = await client
      .post(`/api/trips/${reciente.id}/report`)
      .bearerToken(token)
      .json({ motivo: 'no_pago' })
    ok.assertStatus(201)

    const viejo = await crearViaje(cliente.id, conductorId, {
      finalizadoAt: DateTime.now().minus({ minutes: REPORTE_PLAZO_MIN + 1 }),
    })
    const tarde = await client
      .post(`/api/trips/${viejo.id}/report`)
      .bearerToken(token)
      .json({ motivo: 'no_pago' })
    tarde.assertStatus(422)
    tarde.assertBodyContains({
      message: `El plazo para reportar este viaje ya venció (${REPORTE_PLAZO_MIN} minutos)`,
    })

    // Sin finalizadoAt se usa completadoAt.
    const porCompletado = await crearViaje(cliente.id, conductorId, {
      completadoAt: DateTime.now().minus({ minutes: REPORTE_PLAZO_MIN + 5 }),
    })
    const tarde2 = await client
      .post(`/api/trips/${porCompletado.id}/report`)
      .bearerToken(token)
      .json({ motivo: 'otro' })
    tarde2.assertStatus(422)
  })
})
