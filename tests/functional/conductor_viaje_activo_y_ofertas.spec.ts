import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import ConfiguracionPlataforma from '#models/configuracion_plataforma'
import Conductor from '#models/conductor'
import Oferta from '#models/oferta'

/**
 * 1) GET /api/trips/active del conductor: si no tiene un viaje realmente activo,
 *    devuelve su viaje más reciente en `pendiente_confirmacion` (esperando que el
 *    cliente confirme la entrega), para no perderlo al reiniciar la app. El
 *    conductor sigue libre para tomar otro viaje en ese estado.
 * 2) El conductor puede ver sus ofertas pendientes y su vencimiento:
 *    POST /api/trips/:id/offers incluye `expiresAt` y GET /api/drivers/offers
 *    lista sus ofertas pendientes no vencidas.
 */

const uniq = () => `${Date.now()}${Math.floor(Math.random() * 1e6)}`
const ORIGEN = { direccion: 'Parque Caldas', lat: 2.4419, lng: -76.6063 }
const DESTINO = { direccion: 'Terminal', lat: 2.4569, lng: -76.5952 }

async function registrarCliente(client: any) {
  const res = await client.post('/api/auth/register').json({
    nombre: 'Cli',
    apellido: 'ActOf',
    email: `actof_cli_${uniq()}@test.com`,
    password: 'Password123',
    rol: 'cliente',
    edad: 30,
  })
  res.assertStatus(200)
  const body = res.body() as { token: string; id: string }
  return { token: body.token, id: Number(body.id) }
}

async function registrarConductor(client: any) {
  const res = await client.post('/api/auth/register').json({
    nombre: 'Con',
    apellido: 'ActOf',
    email: `actof_con_${uniq()}@test.com`,
    password: 'Password123',
    rol: 'conductor',
    edad: 35,
    cedula: `${uniq()}`.slice(-9),
    placa: `AOF${`${uniq()}`.slice(-3)}`,
    tipoVehiculo: 'camioneta',
    capacidad: '1 tonelada',
    ciudad: 'popayan',
  })
  res.assertStatus(200)
  const body = res.body() as { token: string; id: string }
  const conductor = await Conductor.findByOrFail('usuario_id', Number(body.id))
  conductor.estadoVerificacion = 'aprobado'
  conductor.ciudad = 'popayan'
  conductor.ultimaUbicacionLat = ORIGEN.lat
  conductor.ultimaUbicacionLng = ORIGEN.lng
  conductor.ubicacionActualizadaEn = DateTime.now()
  await conductor.save()
  return { token: body.token, conductorId: conductor.id }
}

async function pedirViaje(client: any, token: string) {
  const res = await client.post('/api/trips/request').bearerToken(token).json({
    origen: ORIGEN,
    destino: DESTINO,
    descripcion: 'Caja',
    precioCliente: 50000,
  })
  res.assertStatus(200)
  return Number((res.body() as { id: string }).id)
}

async function asignar(viajeId: number, conductorId: number, estado: string) {
  await db.from('viajes').where('id', viajeId).update({ conductor_id: conductorId, estado })
}

test.group('GET /api/trips/active del conductor con viaje por confirmar', (group) => {
  group.each.setup(async () => {
    await ConfiguracionPlataforma.query().delete()
  })

  test('devuelve el viaje en pendiente_confirmacion si no hay otro activo', async ({
    client,
    assert,
  }) => {
    const cliente = await registrarCliente(client)
    const driver = await registrarConductor(client)
    const viajeId = await pedirViaje(client, cliente.token)
    await asignar(viajeId, driver.conductorId, 'pendiente_confirmacion')

    const res = await client.get('/api/trips/active').bearerToken(driver.token)
    res.assertStatus(200)
    assert.equal(Number(res.body().id), viajeId)
    assert.equal(res.body().estado, 'pendiente_confirmacion')
    assert.properties(res.body(), ['cliente', 'conductor', 'origen', 'destino'])
  })

  test('prioriza el viaje realmente activo sobre el pendiente de confirmación', async ({
    client,
    assert,
  }) => {
    const cliente1 = await registrarCliente(client)
    const cliente2 = await registrarCliente(client)
    const driver = await registrarConductor(client)
    const pendiente = await pedirViaje(client, cliente1.token)
    await asignar(pendiente, driver.conductorId, 'pendiente_confirmacion')
    const activo = await pedirViaje(client, cliente2.token)
    await asignar(activo, driver.conductorId, 'en_curso')

    const res = await client.get('/api/trips/active').bearerToken(driver.token)
    res.assertStatus(200)
    assert.equal(Number(res.body().id), activo)
    assert.equal(res.body().estado, 'en_curso')
  })

  test('sin viajes activos ni por confirmar sigue respondiendo 404', async ({ client }) => {
    const driver = await registrarConductor(client)
    const res = await client.get('/api/trips/active').bearerToken(driver.token)
    res.assertStatus(404)
    res.assertBody({ error: 'No active trip' })
  })
})

test.group('Ofertas pendientes del conductor', (group) => {
  group.each.setup(async () => {
    await ConfiguracionPlataforma.query().delete()
  })

  test('POST /api/trips/:id/offers incluye expiresAt', async ({ client, assert }) => {
    const cliente = await registrarCliente(client)
    const driver = await registrarConductor(client)
    const viajeId = await pedirViaje(client, cliente.token)

    const res = await client
      .post(`/api/trips/${viajeId}/offers`)
      .bearerToken(driver.token)
      .json({ monto: 55000 })
    res.assertStatus(201)
    const body = res.body()
    assert.properties(body, ['id', 'viajeId', 'monto', 'estado', 'createdAt', 'expiresAt'])
    const oferta = await Oferta.findOrFail(Number(body.id))
    // La BD guarda el vencimiento sin milisegundos.
    const expira = DateTime.fromISO(body.expiresAt)
    assert.isTrue(expira.isValid)
    assert.isBelow(Math.abs(expira.toMillis() - oferta.expiraAt!.toMillis()), 1000)
    assert.isTrue(expira > DateTime.now())
  })

  test('GET /api/drivers/offers responde 401 sin autenticación', async ({ client }) => {
    const res = await client.get('/api/drivers/offers')
    res.assertStatus(401)
  })

  test('GET /api/drivers/offers responde 403 a un cliente', async ({ client }) => {
    const cliente = await registrarCliente(client)
    const res = await client.get('/api/drivers/offers').bearerToken(cliente.token)
    res.assertStatus(403)
  })

  test('lista solo las ofertas propias pendientes y no vencidas', async ({ client, assert }) => {
    const cliente1 = await registrarCliente(client)
    const cliente2 = await registrarCliente(client)
    const driver = await registrarConductor(client)
    const otro = await registrarConductor(client)
    const viaje1 = await pedirViaje(client, cliente1.token)
    const viaje2 = await pedirViaje(client, cliente2.token)

    const crear = (viajeId: number, conductorId: number, estado: string, expiraAt: DateTime) =>
      Oferta.create({ viajeId, conductorId, monto: 60000, estado, expiraAt })

    const vigente = await crear(viaje1, driver.conductorId, 'pendiente', DateTime.now().plus({ minutes: 5 }))
    await crear(viaje2, driver.conductorId, 'pendiente', DateTime.now().minus({ seconds: 5 }))
    await crear(viaje2, driver.conductorId, 'rechazada', DateTime.now().plus({ minutes: 5 }))
    await crear(viaje1, otro.conductorId, 'pendiente', DateTime.now().plus({ minutes: 5 }))
    await vigente.refresh()

    const res = await client.get('/api/drivers/offers').bearerToken(driver.token)
    res.assertStatus(200)
    const lista = res.body() as any[]
    assert.lengthOf(lista, 1)
    assert.deepEqual(lista[0], {
      id: String(vigente.id),
      viajeId: String(viaje1),
      monto: 60000,
      estado: 'pendiente',
      expiresAt: vigente.expiraAt!.toISO(),
      createdAt: vigente.createdAt.toISO(),
      viaje: {
        origen: { direccion: ORIGEN.direccion, lat: ORIGEN.lat, lng: ORIGEN.lng },
        destino: { direccion: DESTINO.direccion, lat: DESTINO.lat, lng: DESTINO.lng },
        estado: 'buscando_conductor',
      },
    })
  })
})
