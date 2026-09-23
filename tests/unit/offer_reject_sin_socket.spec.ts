import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import User from '#models/user'
import Conductor from '#models/conductor'
import Viaje from '#models/viaje'
import Oferta from '#models/oferta'
import OfferController from '#controllers/offer_controller'

/**
 * Auditoría IMPORTANTE #5: rechazar una oferta no debe responder 500 cuando
 * Socket.IO no está inicializado (la suite unitaria corre sin sockets).
 */

const uniq = () => `${Date.now()}${Math.floor(Math.random() * 1e6)}`

async function crearUsuario(rol: string) {
  const [id] = await db.table('users').insert({
    nombre: 'Rej',
    apellido: rol,
    email: `reject_${rol}_${uniq()}@test.com`,
    password: 'x',
    rol,
    created_at: '2026-01-01 00:00:00',
    updated_at: '2026-01-01 00:00:00',
  })
  return User.findOrFail(Number(id))
}

function respuestaFalsa() {
  const res = { statusCode: 200, body: undefined as unknown }
  const response = {
    status(code: number) {
      res.statusCode = code
      return response
    },
    send(body: unknown) {
      res.body = body
      return body
    },
  }
  return { res, response }
}

test.group('Auditoría #5 - rechazar oferta sin Socket.IO', () => {
  test('responde 200 y marca la oferta como rechazada', async ({ assert }) => {
    const cliente = await crearUsuario('cliente')
    const conductorUser = await crearUsuario('conductor')
    const conductor = await Conductor.create({
      usuarioId: conductorUser.id,
      cedula: uniq().slice(-10),
      placa: `REJ${uniq().slice(-5)}`,
      estadoVerificacion: 'aprobado',
    })
    const viaje = await Viaje.create({
      clienteId: cliente.id,
      estado: 'pendiente',
      origenDireccion: 'A',
      origenLat: 2.44,
      origenLng: -76.6,
      destinoDireccion: 'B',
      destinoLat: 2.45,
      destinoLng: -76.59,
      precioCliente: 10000,
      precioEstimado: 10000,
    })
    const oferta = await Oferta.create({
      viajeId: viaje.id,
      conductorId: conductor.id,
      monto: 9000,
      estado: 'pendiente',
    })

    const { res, response } = respuestaFalsa()
    const ctx = {
      auth: { getUserOrFail: () => cliente },
      params: { id: String(viaje.id), offerId: String(oferta.id) },
      response,
    }

    await new OfferController().reject(ctx as any)

    assert.equal(res.statusCode, 200)
    const guardada = await db.from('ofertas').where('id', oferta.id).first()
    assert.equal(guardada.estado, 'rechazada')
  }).timeout(10000)
})
