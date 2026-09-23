import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import ConfiguracionPlataforma from '#models/configuracion_plataforma'

/**
 * Un viaje en `pendiente_confirmacion` (el conductor finalizó y el cliente
 * debe confirmar la entrega) sigue siendo el viaje activo del cliente:
 * - GET /api/trips/active lo devuelve (para volver a la pantalla de confirmar).
 * - No puede pedir ni reservar otro viaje mientras tanto (409).
 */

const uniq = () => `${Date.now()}${Math.floor(Math.random() * 1e6)}`
const ORIGEN = { direccion: 'Origen pc', lat: 2.4419, lng: -76.6063 }
const DESTINO = { direccion: 'Destino pc', lat: 2.4569, lng: -76.5952 }

async function clienteConViajePendienteConfirmacion(client: any) {
  const res = await client.post('/api/auth/register').json({
    nombre: 'Cli',
    apellido: 'PendConf',
    email: `pendconf_${uniq()}@test.com`,
    password: 'Password123',
    rol: 'cliente',
    edad: 30,
  })
  res.assertStatus(200)
  const token = res.body().token as string
  const id = Number(res.body().id)

  const pedido = await client.post('/api/trips/request').bearerToken(token).json({
    origen: ORIGEN,
    destino: DESTINO,
    descripcion: 'Viaje por confirmar',
    precioCliente: 30000,
  })
  pedido.assertStatus(200)

  const viaje = await db.from('viajes').where('cliente_id', id).firstOrFail()
  await db.from('viajes').where('id', viaje.id).update({ estado: 'pendiente_confirmacion' })
  return { token, id, viajeId: Number(viaje.id) }
}

test.group('Viaje activo del cliente en pendiente_confirmacion', (group) => {
  group.each.setup(async () => {
    await ConfiguracionPlataforma.query().delete()
  })

  test('GET /api/trips/active devuelve el viaje pendiente de confirmación', async ({
    client,
    assert,
  }) => {
    const { token, viajeId } = await clienteConViajePendienteConfirmacion(client)

    const res = await client.get('/api/trips/active').bearerToken(token)
    res.assertStatus(200)
    assert.equal(Number(res.body().id), viajeId)
    assert.equal(res.body().estado, 'pendiente_confirmacion')
  })

  test('POST /api/trips/request responde 409 mientras hay un viaje por confirmar', async ({
    client,
    assert,
  }) => {
    const { token, id } = await clienteConViajePendienteConfirmacion(client)

    const res = await client.post('/api/trips/request').bearerToken(token).json({
      origen: ORIGEN,
      destino: DESTINO,
      descripcion: 'Segundo viaje',
      precioCliente: 30000,
    })
    res.assertStatus(409)

    const viajes = await db.from('viajes').where('cliente_id', id)
    assert.lengthOf(viajes, 1)
  })

  test('POST /api/trips/reserve responde 409 mientras hay un viaje por confirmar', async ({
    client,
    assert,
  }) => {
    const { token, id } = await clienteConViajePendienteConfirmacion(client)
    const fecha = DateTime.now().setZone('America/Bogota').plus({ days: 3 }).toISODate()!

    const res = await client.post('/api/trips/reserve').bearerToken(token).json({
      origen: ORIGEN,
      destino: DESTINO,
      descripcion: 'Reserva',
      precioCliente: 30000,
      fechaProgramada: fecha,
      horaProgramada: '10:30',
    })
    res.assertStatus(409)

    const viajes = await db.from('viajes').where('cliente_id', id)
    assert.lengthOf(viajes, 1)
  })
})
