import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'

const ORIGEN = { lat: 3.4516, lng: -76.532 }
const DESTINO = { lat: 3.452, lng: -76.531 }

function email(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 100000000)}@test.com`
}

function latKm(base: number, km: number) {
  return base + km / 111
}

async function registrarCliente(client: any) {
  const res = await client.post('/api/auth/register').json({
    nombre: 'AF',
    apellido: 'Cliente',
    email: email('af-cliente'),
    password: '123456',
    rol: 'cliente', edad: 30,
  })
  res.assertStatus(200)
  return { token: res.body().token as string, id: Number(res.body().id) }
}

async function registrarConductor(client: any) {
  const res = await client.post('/api/auth/register').json({
    nombre: 'AF',
    apellido: 'Conductor',
    email: email('af-driver'),
    password: '123456',
    rol: 'conductor', edad: 30,
    cedula: `${Date.now()}${Math.floor(Math.random() * 100000)}`.slice(-16),
    placa: `AF${Date.now().toString().slice(-8)}${Math.floor(Math.random() * 1000)}`,
    tipoVehiculo: 'camioneta',
    capacidad: '1000 kg',
  })
  res.assertStatus(200)
  const userId = Number(res.body().id)
  await db.from('conductores').where('usuario_id', userId).update({ estado_verificacion: 'aprobado' })
  const conductor = await db.from('conductores').where('usuario_id', userId).first()
  return {
    token: res.body().token as string,
    userId,
    conductorId: Number(conductor.id),
  }
}

async function crearViajeAceptado(client: any, clientToken: string, conductorToken: string) {
  const trip = await client
    .post('/api/trips/request')
    .header('Authorization', `Bearer ${clientToken}`)
    .json({
      origen: { direccion: 'Origen AF', lat: ORIGEN.lat, lng: ORIGEN.lng },
      destino: { direccion: 'Destino AF', lat: DESTINO.lat, lng: DESTINO.lng },
      descripcion: 'carga antifraude',
      precioCliente: 50000,
    })
  trip.assertStatus(200)
  const tripId = Number(trip.body().id)

  const accept = await client
    .post(`/api/trips/${tripId}/accept`)
    .header('Authorization', `Bearer ${conductorToken}`)
  accept.assertStatus(200)

  return tripId
}

async function iniciarViaje(client: any, conductorToken: string, tripId: number) {
  const res = await client
    .post(`/api/trips/${tripId}/start-trip`)
    .header('Authorization', `Bearer ${conductorToken}`)
  res.assertStatus(200)
}

async function fijarUbicacion(conductorId: number, lat: number, lng: number, edadSegundos = 0) {
  await db.from('conductores').where('id', conductorId).update({
    ultima_ubicacion_lat: lat,
    ultima_ubicacion_lng: lng,
    updated_at: DateTime.now().minus({ seconds: edadSegundos }).toSQL(),
    ubicacion_actualizada_en: DateTime.now().minus({ seconds: edadSegundos }).toSQL(),
  })
}

test.group('Antifraude cierre de servicio', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('R1: cliente cancela con conductor a 0.5 km del origen → 422 CONDUCTOR_CERCA', async ({
    client,
    assert,
  }) => {
    const cliente = await registrarCliente(client)
    const conductor = await registrarConductor(client)
    await fijarUbicacion(conductor.conductorId, latKm(ORIGEN.lat, 0.5), ORIGEN.lng)
    const tripId = await crearViajeAceptado(client, cliente.token, conductor.token)

    const res = await client
      .post(`/api/trips/${tripId}/cancel`)
      .header('Authorization', `Bearer ${cliente.token}`)

    res.assertStatus(422)
    assert.equal(res.body().code, 'CONDUCTOR_CERCA')

    const viaje = await db.from('viajes').where('id', tripId).first()
    assert.equal(viaje.estado, 'aceptado')
  })

  test('R1: conductor cancela sin justificación → 422 JUSTIFICACION_REQUERIDA; con justificación → 200 cancelado', async ({
    client,
    assert,
  }) => {
    const cliente = await registrarCliente(client)
    const conductor = await registrarConductor(client)
    const tripId = await crearViajeAceptado(client, cliente.token, conductor.token)

    const sinJustificacion = await client
      .post(`/api/trips/${tripId}/cancel`)
      .header('Authorization', `Bearer ${conductor.token}`)
    sinJustificacion.assertStatus(422)
    assert.equal(sinJustificacion.body().code, 'JUSTIFICACION_REQUERIDA')

    const conJustificacion = await client
      .post(`/api/trips/${tripId}/cancel`)
      .header('Authorization', `Bearer ${conductor.token}`)
      .json({ justificacion: 'Problema mecánico del vehículo antes de la recogida.' })
    conJustificacion.assertStatus(200)
    assert.equal(conJustificacion.body().estado, 'cancelado')

    const viaje = await db.from('viajes').where('id', tripId).first()
    assert.equal(viaje.estado, 'cancelado')
  })

  test('R2: recogida a 3 km → 422 FUERA_DE_RANGO_ORIGEN; a 0.3 km → 200 en_curso', async ({
    client,
    assert,
  }) => {
    const cliente = await registrarCliente(client)
    const conductor = await registrarConductor(client)
    const tripId = await crearViajeAceptado(client, cliente.token, conductor.token)

    await fijarUbicacion(conductor.conductorId, latKm(ORIGEN.lat, 3), ORIGEN.lng)
    const fuera = await client
      .post(`/api/trips/${tripId}/start-trip`)
      .header('Authorization', `Bearer ${conductor.token}`)
    fuera.assertStatus(422)
    assert.equal(fuera.body().code, 'FUERA_DE_RANGO_ORIGEN')

    await fijarUbicacion(conductor.conductorId, latKm(ORIGEN.lat, 0.3), ORIGEN.lng)
    const dentro = await client
      .post(`/api/trips/${tripId}/start-trip`)
      .header('Authorization', `Bearer ${conductor.token}`)
    dentro.assertStatus(200)
    assert.equal(dentro.body().estado, 'en_curso')

    const viaje = await db.from('viajes').where('id', tripId).first()
    assert.equal(viaje.estado, 'en_curso')
  })

  test('R3: cierre a 0.5 km del destino → 200 pendiente_confirmacion; cliente confirma → finalizado', async ({
    client,
    assert,
  }) => {
    const cliente = await registrarCliente(client)
    const conductor = await registrarConductor(client)
    const tripId = await crearViajeAceptado(client, cliente.token, conductor.token)

    await fijarUbicacion(conductor.conductorId, ORIGEN.lat, ORIGEN.lng)
    await iniciarViaje(client, conductor.token, tripId)

    await fijarUbicacion(conductor.conductorId, latKm(DESTINO.lat, 0.5), DESTINO.lng)
    const completo = await client
      .post(`/api/trips/${tripId}/complete`)
      .header('Authorization', `Bearer ${conductor.token}`)
      .json({ montoFinal: 50000 })
    completo.assertStatus(200)
    assert.equal(completo.body().estado, 'pendiente_confirmacion')

    const confirm = await client
      .post(`/api/trips/${tripId}/confirm-close`)
      .header('Authorization', `Bearer ${cliente.token}`)
      .json({ confirmar: true })
    confirm.assertStatus(200)
    assert.equal(confirm.body().estado, 'finalizado')

    const viaje = await db.from('viajes').where('id', tripId).first()
    assert.equal(viaje.estado, 'finalizado')

    const ganancia = await db.from('ganancias').where('viaje_id', tripId).first()
    assert.isNotNull(ganancia)
  })

  test('R3: cierre a 5 km sin justificación → 422; con justificación → 200 + logs_fraude; cliente rechaza → disputa', async ({
    client,
    assert,
  }) => {
    const cliente = await registrarCliente(client)
    const conductor = await registrarConductor(client)
    const tripId = await crearViajeAceptado(client, cliente.token, conductor.token)

    await fijarUbicacion(conductor.conductorId, ORIGEN.lat, ORIGEN.lng)
    await iniciarViaje(client, conductor.token, tripId)

    await fijarUbicacion(conductor.conductorId, latKm(DESTINO.lat, 5), DESTINO.lng)
    const sinJustificacion = await client
      .post(`/api/trips/${tripId}/complete`)
      .header('Authorization', `Bearer ${conductor.token}`)
      .json({ montoFinal: 50000 })
    sinJustificacion.assertStatus(422)
    assert.equal(sinJustificacion.body().code, 'JUSTIFICACION_REQUERIDA')

    const conJustificacion = await client
      .post(`/api/trips/${tripId}/complete`)
      .header('Authorization', `Bearer ${conductor.token}`)
      .json({ montoFinal: 50000, justificacion: 'El cliente pidió que la entregaran en otra dirección.' })
    conJustificacion.assertStatus(200)
    assert.equal(conJustificacion.body().estado, 'pendiente_confirmacion')

    const fraude = await db
      .from('logs_fraude')
      .where('conductor_id', conductor.conductorId)
      .where('tipo', 'cierre_fuera_de_destino')
      .first()
    assert.isNotNull(fraude)

    const rechazo = await client
      .post(`/api/trips/${tripId}/confirm-close`)
      .header('Authorization', `Bearer ${cliente.token}`)
      .json({ confirmar: false, motivo: 'Nunca recibí la mercancía solicitada.' })
    rechazo.assertStatus(200)
    assert.equal(rechazo.body().estado, 'disputa')

    const viaje = await db.from('viajes').where('id', tripId).first()
    assert.equal(viaje.estado, 'disputa')

    const disputa = await db.from('disputas').where('viaje_id', tripId).first()
    assert.isNotNull(disputa)
  })

  test('confirm-close de otro cliente → 403', async ({ client, assert }) => {
    const cliente = await registrarCliente(client)
    const otro = await registrarCliente(client)
    const conductor = await registrarConductor(client)
    const tripId = await crearViajeAceptado(client, cliente.token, conductor.token)

    await fijarUbicacion(conductor.conductorId, ORIGEN.lat, ORIGEN.lng)
    await iniciarViaje(client, conductor.token, tripId)

await fijarUbicacion(conductor.conductorId, latKm(DESTINO.lat, 0.5), DESTINO.lng)
      const completo = await client
        .post(`/api/trips/${tripId}/complete`)
        .header('Authorization', `Bearer ${conductor.token}`)
        .json({ montoFinal: 50000 })
      completo.assertStatus(200)

      const res = await client
        .post(`/api/trips/${tripId}/confirm-close`)
        .header('Authorization', `Bearer ${otro.token}`)
        .json({ confirmar: true })
    res.assertStatus(403)
  })

  test('ubicación con más de 180 s → 422 UBICACION_NO_RECIENTE', async ({ client, assert }) => {
    const cliente = await registrarCliente(client)
    const conductor = await registrarConductor(client)
    const tripId = await crearViajeAceptado(client, cliente.token, conductor.token)

    await fijarUbicacion(conductor.conductorId, ORIGEN.lat, ORIGEN.lng)
    await iniciarViaje(client, conductor.token, tripId)

    await fijarUbicacion(conductor.conductorId, latKm(DESTINO.lat, 0.5), DESTINO.lng, 200)
    const res = await client
      .post(`/api/trips/${tripId}/complete`)
      .header('Authorization', `Bearer ${conductor.token}`)
      .json({ montoFinal: 50000 })
    res.assertStatus(422)
    assert.equal(res.body().code, 'UBICACION_NO_RECIENTE')
  })

  test('finalize (Puerta Flutter) a 0.5 km del destino → 200 pendiente_confirmacion', async ({ client, assert }) => {
    const cliente = await registrarCliente(client)
    const conductor = await registrarConductor(client)
    const tripId = await crearViajeAceptado(client, cliente.token, conductor.token)

    await fijarUbicacion(conductor.conductorId, ORIGEN.lat, ORIGEN.lng)
    await iniciarViaje(client, conductor.token, tripId)

    await fijarUbicacion(conductor.conductorId, latKm(DESTINO.lat, 0.5), DESTINO.lng)
    const res = await client
      .post(`/api/trips/${tripId}/finalize`)
      .header('Authorization', `Bearer ${conductor.token}`)
      .json({ montoFinal: 52000, justificacion: 'Viaje de prueba finalizado.' })
    res.assertStatus(200)
    assert.equal(res.body().estado, 'pendiente_confirmacion')

    const clienteConfirma = await client
      .post(`/api/trips/${tripId}/confirm-close`)
      .header('Authorization', `Bearer ${cliente.token}`)
      .json({ confirmar: true })
    clienteConfirma.assertStatus(200)
    assert.equal(clienteConfirma.body().estado, 'finalizado')

    const viaje = await db.from('viajes').where('id', tripId).first()
    assert.equal(viaje.estado, 'finalizado')
    assert.equal(viaje.precio_final, 52000)
  })
})