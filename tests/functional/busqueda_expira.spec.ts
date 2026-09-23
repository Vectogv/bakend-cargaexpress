import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'
import { io, type Socket } from 'socket.io-client'
import ConfiguracionPlataforma from '#models/configuracion_plataforma'
import Conductor from '#models/conductor'
import Oferta from '#models/oferta'
import Viaje from '#models/viaje'
import User from '#models/user'
import Notificacion from '#models/notificacion'
import BusquedaTimeoutService from '#services/busqueda_timeout_service'
import ReservationActivationService from '#services/reservation_activation_service'

/**
 * Búsqueda de conductor vencida: un viaje que sigue en `buscando_conductor` o
 * `pendiente` más de BUSQUEDA_TIMEOUT_MIN (15) minutos después de iniciar la
 * búsqueda se cancela por el sistema ('Sin conductores disponibles').
 */

const uniq = () => `${Date.now()}${Math.floor(Math.random() * 1e6)}`
const URL = `http://localhost:${process.env.PORT ?? 3333}`
const sql = (d: DateTime) => d.toFormat('yyyy-MM-dd HH:mm:ss')
const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function registrar(client: any, rol: 'cliente' | 'conductor') {
  const extra =
    rol === 'conductor'
      ? {
          cedula: `${uniq()}`.slice(-9),
          placa: `BSQ${`${uniq()}`.slice(-3)}`,
          tipoVehiculo: 'camioneta',
          capacidad: '1 tonelada',
          ciudad: 'popayan',
        }
      : {}
  const res = await client.post('/api/auth/register').json({
    nombre: rol,
    apellido: 'Busqueda',
    email: `busqueda_${rol}_${uniq()}@test.com`,
    password: 'Password123',
    rol,
    edad: 30,
    ...extra,
  })
  res.assertStatus(200)
  const body = res.body() as { token: string; id: string }
  return { token: body.token, id: Number(body.id) }
}

async function pedirViaje(client: any, token: string) {
  const pedido = await client
    .post('/api/trips/request')
    .bearerToken(token)
    .json({
      origen: { direccion: 'Parque Caldas', lat: 2.4419, lng: -76.6063 },
      destino: { direccion: 'Terminal', lat: 2.4569, lng: -76.5952 },
      descripcion: 'Caja',
      precioCliente: 50000,
    })
  pedido.assertStatus(200)
  return Number((pedido.body() as { id: string }).id)
}

async function envejecer(viajeId: number, minutos: number) {
  await db
    .from('viajes')
    .where('id', viajeId)
    .update({ created_at: sql(DateTime.now().minus({ minutes: minutos })) })
}

function conectar(token: string): Promise<Socket> {
  const socket = io(URL, {
    transports: ['websocket'],
    auth: { token: `Bearer ${token}` },
    query: { token },
  })
  return new Promise((resolve, reject) => {
    socket.once('connect', () => resolve(socket))
    socket.once('connect_error', reject)
  })
}

test.group('Búsqueda de conductor vencida', (group) => {
  group.each.setup(async () => {
    await ConfiguracionPlataforma.query().delete()
  })

  test('cancela un viaje buscando conductor hace más de 15 min y avisa al cliente', async ({
    client,
    assert,
  }) => {
    const cliente = await registrar(client, 'cliente')
    const viajeId = await pedirViaje(client, cliente.token)
    await envejecer(viajeId, 16)
    const reputacionAntes = (await User.findOrFail(cliente.id)).reputacion

    const socket = await conectar(cliente.token)
    const cancelados: any[] = []
    socket.on('trip:cancelled', (d) => cancelados.push(d))

    try {
      const ids = await BusquedaTimeoutService.expirarBusquedasVencidas()
      await esperar(500)
      assert.include(ids, viajeId)

      const viaje = await Viaje.findOrFail(viajeId)
      assert.equal(viaje.estado, 'cancelado')
      assert.equal(viaje.motivoCancelacion, 'Sin conductores disponibles')
      assert.isNotNull(viaje.canceladoAt)

      assert.deepInclude(cancelados, {
        id: String(viajeId),
        estado: 'cancelado',
        motivo: 'Sin conductores disponibles',
        canceladoPor: 'sistema',
      })

      const notif = await Notificacion.query()
        .where('usuario_id', cliente.id)
        .where('tipo', 'busqueda_sin_conductor')
        .first()
      assert.isNotNull(notif)

      // Sin penalización de reputación.
      assert.equal((await User.findOrFail(cliente.id)).reputacion, reputacionAntes)
    } finally {
      socket.disconnect()
    }
  })

  test('no toca un viaje que lleva menos de 15 min buscando', async ({ client, assert }) => {
    const cliente = await registrar(client, 'cliente')
    const viajeId = await pedirViaje(client, cliente.token)
    await envejecer(viajeId, 10)

    const ids = await BusquedaTimeoutService.expirarBusquedasVencidas()
    assert.notInclude(ids, viajeId)
    assert.equal((await Viaje.findOrFail(viajeId)).estado, 'buscando_conductor')
  })

  test('cancela un viaje pendiente y expira sus ofertas avisando al conductor', async ({
    client,
    assert,
  }) => {
    const cliente = await registrar(client, 'cliente')
    const conductorUser = await registrar(client, 'conductor')
    const conductor = await Conductor.findByOrFail('usuario_id', conductorUser.id)
    const viajeId = await pedirViaje(client, cliente.token)
    await db.from('viajes').where('id', viajeId).update({ estado: 'pendiente' })
    await envejecer(viajeId, 20)
    const oferta = await Oferta.create({
      viajeId,
      conductorId: conductor.id,
      monto: 60000,
      estado: 'pendiente',
      expiraAt: DateTime.now().plus({ minutes: 5 }),
    })

    const socketConductor = await conectar(conductorUser.token)
    const alConductor: any[] = []
    socketConductor.on('offer:expired', (d) => alConductor.push(d))

    try {
      const ids = await BusquedaTimeoutService.expirarBusquedasVencidas()
      await esperar(500)
      assert.include(ids, viajeId)
      assert.equal((await Viaje.findOrFail(viajeId)).estado, 'cancelado')
      await oferta.refresh()
      assert.equal(oferta.estado, 'expirada')
      assert.deepInclude(alConductor, { viajeId: String(viajeId), ofertaId: String(oferta.id) })
    } finally {
      socketConductor.disconnect()
    }
  })

  test('dos barridos simultáneos cancelan el viaje una sola vez', async ({ client, assert }) => {
    const cliente = await registrar(client, 'cliente')
    const viajeId = await pedirViaje(client, cliente.token)
    await envejecer(viajeId, 30)

    const [a, b] = await Promise.all([
      BusquedaTimeoutService.expirarBusquedasVencidas(),
      BusquedaTimeoutService.expirarBusquedasVencidas(),
    ])
    assert.lengthOf(
      [...a, ...b].filter((id) => id === viajeId),
      1
    )
    const notifs = await Notificacion.query()
      .where('usuario_id', cliente.id)
      .where('tipo', 'busqueda_sin_conductor')
    assert.lengthOf(notifs, 1)
  })

  test('una reserva cuenta desde que inició la búsqueda, no desde su creación', async ({
    client,
    assert,
  }) => {
    const cliente = await registrar(client, 'cliente')
    const fecha = DateTime.now().setZone('America/Bogota').plus({ days: 2 }).toISODate()!
    const res = await client
      .post('/api/trips/reserve')
      .bearerToken(cliente.token)
      .json({
        origen: { direccion: 'Popayán, Cauca', lat: 2.4448, lng: -76.6147 },
        destino: { direccion: 'Cali, Valle del Cauca', lat: 3.4516, lng: -76.532 },
        descripcion: 'Mercancía general',
        precioCliente: 500000,
        fechaProgramada: fecha,
        horaProgramada: '08:00',
      })
    res.assertStatus(201)
    const viajeId = Number(res.body().id)

    // Creada hace 3 días; el scheduler la activó tarde (ventana vencida hace 1 h).
    await db
      .from('viajes')
      .where('id', viajeId)
      .update({
        created_at: sql(DateTime.now().minus({ days: 3 })),
        activacion_at: sql(DateTime.now().minus({ hours: 1 })),
      })
    assert.equal(await ReservationActivationService.activar(viajeId), 'activada')

    // La búsqueda acaba de iniciar: no se cancela.
    assert.notInclude(await BusquedaTimeoutService.expirarBusquedasVencidas(), viajeId)
    assert.equal((await Viaje.findOrFail(viajeId)).estado, 'buscando_conductor')

    // 16 min después de iniciar la búsqueda, sí.
    await db
      .from('viajes')
      .where('id', viajeId)
      .update({ activacion_at: sql(DateTime.now().minus({ minutes: 16 })) })
    assert.include(await BusquedaTimeoutService.expirarBusquedasVencidas(), viajeId)
    assert.equal((await Viaje.findOrFail(viajeId)).estado, 'cancelado')
  })
})
