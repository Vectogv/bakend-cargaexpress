import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import Conductor from '#models/conductor'
import Viaje from '#models/viaje'
import Calificacion from '#models/calificacion'

/**
 * GET /api/trips/:id trae `yaCalificado` (si quien consulta ya calificó ese
 * viaje) y la BD no admite dos calificaciones del mismo calificador por viaje.
 */

const uniq = () => `${Date.now()}${Math.floor(Math.random() * 1e6)}`

async function registrarCliente(client: any) {
  const res = await client.post('/api/auth/register').json({
    nombre: 'Cli',
    apellido: 'Califica',
    email: `cli_calif_${uniq()}@test.com`,
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
    apellido: 'Califica',
    email: `con_calif_${uniq()}@test.com`,
    password: 'Password123',
    rol: 'conductor',
    edad: 35,
    cedula: `${uniq()}`.slice(-10),
    placa: `RCA${`${uniq()}`.slice(-4)}`,
    tipoVehiculo: 'camioneta',
    capacidad: '1 tonelada',
    ciudad: 'popayan',
  })
  res.assertStatus(200)
  const usuarioId = Number(res.body().id)
  const conductor = await Conductor.findByOrFail('usuario_id', usuarioId)
  return { token: res.body().token as string, conductorId: conductor.id, usuarioId }
}

test.group('yaCalificado en el detalle del viaje', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('false antes de calificar, true después, y cada parte por separado', async ({ client, assert }) => {
    const cliente = await registrarCliente(client)
    const conductor = await registrarConductor(client)
    const viaje = await Viaje.create({
      clienteId: cliente.id,
      conductorId: conductor.conductorId,
      estado: 'finalizado',
      origenDireccion: 'Parque Caldas',
      origenLat: 2.4419,
      origenLng: -76.6063,
      destinoDireccion: 'Terminal',
      destinoLat: 2.4569,
      destinoLng: -76.5952,
      precioCliente: 50000,
      precioEstimado: 50000,
    } as any)

    const antes = await client.get(`/api/trips/${viaje.id}`).bearerToken(cliente.token)
    antes.assertStatus(200)
    assert.isFalse(antes.body().yaCalificado)

    const rate = await client
      .post(`/api/trips/${viaje.id}/rate`)
      .bearerToken(cliente.token)
      .json({ puntaje: 5 })
    rate.assertStatus(200)

    const despues = await client.get(`/api/trips/${viaje.id}`).bearerToken(cliente.token)
    assert.isTrue(despues.body().yaCalificado)

    // El conductor todavía no ha calificado: para él sigue en false.
    const delConductor = await client.get(`/api/trips/${viaje.id}`).bearerToken(conductor.token)
    delConductor.assertStatus(200)
    assert.isFalse(delConductor.body().yaCalificado)

    // rate() sigue respondiendo 400 al repetir.
    const repetida = await client
      .post(`/api/trips/${viaje.id}/rate`)
      .bearerToken(cliente.token)
      .json({ puntaje: 4 })
    repetida.assertStatus(400)
    repetida.assertBodyContains({ error: 'Ya calificaste este viaje' })

    // Y la BD rechaza el duplicado aunque se salte el controlador.
    await assert.rejects(() =>
      Calificacion.create({
        viajeId: viaje.id,
        calificadorId: cliente.id,
        calificadoId: conductor.usuarioId,
        puntaje: 3,
        comentario: null,
        tipo: 'cliente_a_conductor',
      })
    )
  })
})
