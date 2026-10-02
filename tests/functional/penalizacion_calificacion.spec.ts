import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'
import Conductor from '#models/conductor'
import { calificacionVisible, recalcularCalificacionConductor } from '#services/calificacion_conductor'

const ORIGEN = { lat: 3.4516, lng: -76.532 }
const DESTINO = { lat: 3.452, lng: -76.531 }

function email(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 100000000)}@test.com`
}

async function registerClient(client: any) {
  const res = await client.post('/api/auth/register').json({
    nombre: 'HF',
    apellido: 'Cliente',
    email: email('hf-cliente'),
    password: '123456',
    rol: 'cliente',
    edad: 30,
  })
  res.assertStatus(200)
  return { token: res.body().token as string, id: Number(res.body().id) }
}

async function registerDriver(client: any) {
  const res = await client.post('/api/auth/register').json({
    nombre: 'HF',
    apellido: 'Conductor',
    email: email('hf-driver'),
    password: '123456',
    rol: 'conductor',
    edad: 30,
    cedula: `${Date.now()}${Math.floor(Math.random() * 100000)}`.slice(-16),
    placa: `HF${Date.now().toString().slice(-8)}${Math.floor(Math.random() * 1000)}`,
    tipoVehiculo: 'camioneta',
    capacidad: '1000 kg',
  })
  res.assertStatus(200)
  const userId = Number(res.body().id)
  await db.from('conductores').where('usuario_id', userId).update({ estado_verificacion: 'aprobado' })
  const conductor = await db.from('conductores').where('usuario_id', userId).first()
  return { token: res.body().token as string, userId, conductorId: Number(conductor.id) }
}

async function fijarUbicacion(conductorId: number, lat: number, lng: number, edadSegundos = 0) {
  await db.from('conductores').where('id', conductorId).update({
    ultima_ubicacion_lat: lat,
    ultima_ubicacion_lng: lng,
    updated_at: DateTime.now().minus({ seconds: edadSegundos }).toSQL(),
    ubicacion_actualizada_en: DateTime.now().minus({ seconds: edadSegundos }).toSQL(),
  })
}

async function crearViaje(client: any, clientToken: string) {
  const res = await client
    .post('/api/trips/request')
    .header('Authorization', `Bearer ${clientToken}`)
    .json({
      origen: { direccion: 'Origen HF', lat: ORIGEN.lat, lng: ORIGEN.lng },
      destino: { direccion: 'Destino HF', lat: DESTINO.lat, lng: DESTINO.lng },
      descripcion: 'carga huecos',
      precioCliente: 50000,
    })
  res.assertStatus(200)
  return Number(res.body().id)
}

async function aceptarViaje(client: any, driverToken: string, tripId: number) {
  const res = await client
    .post(`/api/trips/${tripId}/accept`)
    .header('Authorization', `Bearer ${driverToken}`)
  res.assertStatus(200)
}

async function calificar(viajeId: number, calificadorId: number, calificadoId: number, puntaje: number) {
  await db.table('calificaciones').insert({
    viaje_id: viajeId,
    calificador_id: calificadorId,
    calificado_id: calificadoId,
    puntaje,
    tipo: 'cliente_a_conductor',
    created_at: DateTime.now().toSQL(),
  })
}

async function cancelarComoConductor(client: any, driverToken: string, tripId: number) {
  const res = await client
    .post(`/api/trips/${tripId}/cancel`)
    .header('Authorization', `Bearer ${driverToken}`)
    .json({ justificacion: 'Falla mecánica del vehículo antes de la recogida.' })
  res.assertStatus(200)
}

async function estadoConductor(conductorId: number) {
  const c = await db.from('conductores').where('id', conductorId).first()
  return { calificacion: Number(c.calificacion), penalizacion: Number(c.penalizacion_cancelacion) }
}

test.group('calificacionVisible', () => {
  test('resta la penalización con piso 1 y sin datos queda en 0', ({ assert }) => {
    assert.equal(calificacionVisible(0, 0), 0)
    assert.equal(calificacionVisible(0, 0.5), 4.5)
    assert.equal(calificacionVisible(4, 0.5), 3.5)
    assert.equal(calificacionVisible(4.66, 0), 4.7)
    assert.equal(calificacionVisible(3, 10), 1)
  })
})

test.group('Cancelar un viaje asignado resta 0,5 a la calificación visible', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('promedio 4,0 → 3,5 y la siguiente calificación no borra la penalización', async ({ client, assert }) => {
    const cliente = await registerClient(client)
    const otro = await registerClient(client)
    const driver = await registerDriver(client)
    await fijarUbicacion(driver.conductorId, ORIGEN.lat, ORIGEN.lng)
    const tripId = await crearViaje(client, cliente.token)
    await calificar(tripId, cliente.id, driver.userId, 4)
    await recalcularCalificacionConductor(await Conductor.findOrFail(driver.conductorId))
    await aceptarViaje(client, driver.token, tripId)

    await cancelarComoConductor(client, driver.token, tripId)
    assert.deepEqual(await estadoConductor(driver.conductorId), { calificacion: 3.5, penalizacion: 0.5 })

    // Nueva calificación de 5: promedio 4,5 − 0,5 = 4,0
    await calificar(tripId, otro.id, driver.userId, 5)
    await recalcularCalificacionConductor(await Conductor.findOrFail(driver.conductorId))
    assert.deepEqual(await estadoConductor(driver.conductorId), { calificacion: 4, penalizacion: 0.5 })
  })

  test('sin calificaciones, cancelar deja 4,5', async ({ client, assert }) => {
    const cliente = await registerClient(client)
    const driver = await registerDriver(client)
    await fijarUbicacion(driver.conductorId, ORIGEN.lat, ORIGEN.lng)
    const tripId = await crearViaje(client, cliente.token)
    await aceptarViaje(client, driver.token, tripId)

    await cancelarComoConductor(client, driver.token, tripId)
    assert.deepEqual(await estadoConductor(driver.conductorId), { calificacion: 4.5, penalizacion: 0.5 })
  })

  test('piso de 1,0 con penalización acumulada', async ({ client, assert }) => {
    const cliente = await registerClient(client)
    const driver = await registerDriver(client)
    await db.from('conductores').where('id', driver.conductorId).update({ penalizacion_cancelacion: 4.5 })
    await fijarUbicacion(driver.conductorId, ORIGEN.lat, ORIGEN.lng)
    const tripId = await crearViaje(client, cliente.token)
    await aceptarViaje(client, driver.token, tripId)

    await cancelarComoConductor(client, driver.token, tripId)
    assert.deepEqual(await estadoConductor(driver.conductorId), { calificacion: 1, penalizacion: 5 })
  })

  test('el cliente cancela la búsqueda: el conductor no cambia', async ({ client, assert }) => {
    const cliente = await registerClient(client)
    const driver = await registerDriver(client)
    const tripId = await crearViaje(client, cliente.token)
    await calificar(tripId, cliente.id, driver.userId, 4)
    await recalcularCalificacionConductor(await Conductor.findOrFail(driver.conductorId))

    const res = await client
      .post(`/api/trips/${tripId}/cancel`)
      .header('Authorization', `Bearer ${cliente.token}`)
      .json({ justificacion: 'Ya no necesito el envío.' })
    res.assertStatus(200)
    assert.deepEqual(await estadoConductor(driver.conductorId), { calificacion: 4, penalizacion: 0 })
  })
})
