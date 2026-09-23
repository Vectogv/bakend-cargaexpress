import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import { io, type Socket } from 'socket.io-client'
import ConfiguracionPlataforma from '#models/configuracion_plataforma'
import Conductor from '#models/conductor'
import Oferta from '#models/oferta'
import OfferExpiryService from '#services/offer_expiry_service'

/**
 * Ofertas vencidas: una oferta `pendiente` cuyo `expira_at` ya pasó se marca
 * `expirada` (barrido periódico del scheduler). El cliente recibe
 * `offer:cancelled` (la app ya lo escucha y quita la oferta de la lista) y el
 * conductor `offer:expired`.
 */

const uniq = () => `${Date.now()}${Math.floor(Math.random() * 1e6)}`
const URL = `http://localhost:${process.env.PORT ?? 3333}`

async function registrar(client: any, rol: 'cliente' | 'conductor') {
  const extra =
    rol === 'conductor'
      ? {
          cedula: `${uniq()}`.slice(-9),
          placa: `EXP${`${uniq()}`.slice(-3)}`,
          tipoVehiculo: 'camioneta',
          capacidad: '1 tonelada',
          ciudad: 'popayan',
        }
      : {}
  const res = await client.post('/api/auth/register').json({
    nombre: rol,
    apellido: 'Vencida',
    email: `vencida_${rol}_${uniq()}@test.com`,
    password: 'Password123',
    rol,
    edad: 30,
    ...extra,
  })
  res.assertStatus(200)
  const body = res.body() as { token: string; id: string }
  return { token: body.token, id: Number(body.id) }
}

async function escenario(client: any) {
  const cliente = await registrar(client, 'cliente')
  const conductorUser = await registrar(client, 'conductor')
  const conductor = await Conductor.findByOrFail('usuario_id', conductorUser.id)

  const pedido = await client
    .post('/api/trips/request')
    .bearerToken(cliente.token)
    .json({
      origen: { direccion: 'Parque Caldas', lat: 2.4419, lng: -76.6063 },
      destino: { direccion: 'Terminal', lat: 2.4569, lng: -76.5952 },
      descripcion: 'Caja',
      precioCliente: 50000,
    })
  pedido.assertStatus(200)
  const viajeId = Number((pedido.body() as { id: string }).id)

  const oferta = (expiraAt: DateTime | null) =>
    Oferta.create({
      viajeId,
      conductorId: conductor.id,
      monto: 60000,
      estado: 'pendiente',
      expiraAt,
    })

  return { cliente, conductorUser, viajeId, oferta }
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

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms))

test.group('Ofertas vencidas', (group) => {
  group.each.setup(async () => {
    await ConfiguracionPlataforma.query().delete()
  })

  test('marca como expiradas solo las pendientes vencidas y es idempotente', async ({
    client,
    assert,
  }) => {
    const { oferta } = await escenario(client)
    const vencida = await oferta(DateTime.now().minus({ seconds: 30 }))
    const vigente = await oferta(DateTime.now().plus({ minutes: 5 }))
    const sinPlazo = await oferta(null)
    const aceptada = await oferta(DateTime.now().minus({ minutes: 1 }))
    aceptada.estado = 'aceptada'
    await aceptada.save()

    const expiradas = await OfferExpiryService.expirarVencidas()
    assert.include(expiradas, vencida.id)
    assert.notInclude(expiradas, vigente.id)
    assert.notInclude(expiradas, sinPlazo.id)
    assert.notInclude(expiradas, aceptada.id)

    await Promise.all([vencida, vigente, sinPlazo, aceptada].map((o) => o.refresh()))
    assert.equal(vencida.estado, 'expirada')
    assert.equal(vigente.estado, 'pendiente')
    assert.equal(sinPlazo.estado, 'pendiente')
    assert.equal(aceptada.estado, 'aceptada')

    // Un segundo barrido (u otra instancia a la vez) no vuelve a procesarla.
    assert.notInclude(await OfferExpiryService.expirarVencidas(), vencida.id)

    // Dos barridos simultáneos: la oferta se expira (y se notifica) una sola vez.
    const otra = await oferta(DateTime.now().minus({ seconds: 10 }))
    const [a, b] = await Promise.all([
      OfferExpiryService.expirarVencidas(),
      OfferExpiryService.expirarVencidas(),
    ])
    assert.lengthOf(
      [...a, ...b].filter((id) => id === otra.id),
      1
    )
  })

  test('avisa al cliente con offer:cancelled y al conductor con offer:expired', async ({
    client,
    assert,
  }) => {
    const { cliente, conductorUser, viajeId, oferta } = await escenario(client)
    const vencida = await oferta(DateTime.now().minus({ seconds: 30 }))

    const socketCliente = await conectar(cliente.token)
    const socketConductor = await conectar(conductorUser.token)
    const alCliente: any[] = []
    const alConductor: any[] = []
    socketCliente.on('offer:cancelled', (d) => alCliente.push(d))
    socketConductor.on('offer:expired', (d) => alConductor.push(d))

    try {
      await OfferExpiryService.expirarVencidas()
      await esperar(500)

      const esperado = { viajeId: String(viajeId), ofertaId: String(vencida.id) }
      assert.deepInclude(alCliente, esperado)
      assert.deepInclude(alConductor, esperado)
    } finally {
      socketCliente.disconnect()
      socketConductor.disconnect()
    }
  })
})
