import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'
import Viaje from '#models/viaje'
import ReservationActivationService from '#services/reservation_activation_service'
import reservationConfig from '#config/reservations'
import { parseScheduledDateTime } from '#services/reservation_time'

const TZ = 'America/Bogota'
const ORIGEN = { direccion: 'Popayán, Cauca', lat: 2.4448, lng: -76.6147 }
const DESTINO = { direccion: 'Cali, Valle del Cauca', lat: 3.4516, lng: -76.532 }

function uniqueEmail(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 100000)}@test.com`
}

async function registerClient(client: any) {
  const res = await client.post('/api/auth/register').json({
    nombre: 'Asig',
    apellido: 'Cliente',
    email: uniqueEmail('asig-cliente'),
    password: '123456',
    rol: 'cliente',
    edad: 30,
  })
  res.assertStatus(200)
  return { token: res.body().token as string, id: Number(res.body().id) }
}

async function registerDriver(client: any) {
  const res = await client.post('/api/auth/register').json({
    nombre: 'Asig',
    apellido: 'Conductor',
    email: uniqueEmail('asig-driver'),
    password: '123456',
    rol: 'conductor',
    edad: 30,
    cedula: `${Date.now()}${Math.floor(Math.random() * 1000)}`,
    placa: `ASG-${Date.now()}${Math.floor(Math.random() * 1000)}`,
    tipoVehiculo: 'camioneta',
    capacidad: '1000 kg',
  })
  res.assertStatus(200)
  const id = Number(res.body().id)
  // Aprobado y ubicado en el origen (a < 1 km) para probar que la regla del
  // kilómetro no aplica a las reservas.
  await db.from('conductores').where('usuario_id', id).update({
    estado_verificacion: 'aprobado',
    ultima_ubicacion_lat: ORIGEN.lat,
    ultima_ubicacion_lng: ORIGEN.lng,
    updated_at: DateTime.now().toSQL(),
    ubicacion_actualizada_en: DateTime.now().toSQL(),
  })
  const conductor = await db.from('conductores').where('usuario_id', id).first()
  return { token: res.body().token as string, id, conductorId: Number(conductor.id) }
}

async function crearReserva(client: any, token: string, dias = 2) {
  const fecha = DateTime.now().setZone(TZ).plus({ days: dias }).toISODate()!
  const res = await client
    .post('/api/trips/reserve')
    .header('Authorization', `Bearer ${token}`)
    .json({
      origen: ORIGEN,
      destino: DESTINO,
      descripcion: 'Mercancía general',
      precioCliente: 500000,
      fechaProgramada: fecha,
      horaProgramada: '08:00',
    })
  res.assertStatus(201)
  return { viajeId: Number(res.body().id), fecha }
}

/** Reserva con conductor asignado por el flujo real: oferta + aceptación. */
async function reservaAsignada(client: any, dias = 2) {
  const cliente = await registerClient(client)
  const driver = await registerDriver(client)
  const { viajeId, fecha } = await crearReserva(client, cliente.token, dias)

  const oferta = await client
    .post(`/api/trips/${viajeId}/offers`)
    .header('Authorization', `Bearer ${driver.token}`)
    .json({ monto: 480000 })
  oferta.assertStatus(201)

  const aceptar = await client
    .post(`/api/trips/${viajeId}/offers/${Number(oferta.body().id)}/accept`)
    .header('Authorization', `Bearer ${cliente.token}`)
  aceptar.assertStatus(200)

  return { cliente, driver, viajeId, fecha, ofertaId: Number(oferta.body().id) }
}

async function activacionVencida(viajeId: number) {
  await db
    .from('viajes')
    .where('id', viajeId)
    .update({ activacion_at: DateTime.now().minus({ minutes: 1 }).toFormat('yyyy-MM-dd HH:mm:ss') })
}

test.group('Reserva con conductor asignado al reservar', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('oferta + aceptación: sigue reservado, con conductor y activación 45 min antes', async ({
    client,
    assert,
  }) => {
    const cliente = await registerClient(client)
    const driver = await registerDriver(client)
    const { viajeId, fecha } = await crearReserva(client, cliente.token)

    // Vista previa para cualquier conductor mientras no tenga conductor.
    // ponytail: /nearby se limita a 20 sin orden y otras pruebas dejan viajes
    // en el origen; se verifica por /show (misma regla de "sin asignar").
    const preview = await client
      .get(`/api/trips/${viajeId}`)
      .header('Authorization', `Bearer ${driver.token}`)
    preview.assertStatus(200)

    const oferta = await client
      .post(`/api/trips/${viajeId}/offers`)
      .header('Authorization', `Bearer ${driver.token}`)
      .json({ monto: 480000 })
    oferta.assertStatus(201)

    let viaje = await Viaje.findOrFail(viajeId)
    assert.equal(viaje.estado, 'reservado')
    assert.isNull(viaje.conductorId)

    // La oferta vence a lo sumo en la activación (no en 28 s).
    const ofertaRow = await db.from('ofertas').where('id', Number(oferta.body().id)).first()
    assert.isTrue(DateTime.fromSQL(ofertaRow.expira_at) > DateTime.now().plus({ hours: 1 }))

    const lista = await client
      .get(`/api/trips/${viajeId}/offers`)
      .header('Authorization', `Bearer ${cliente.token}`)
    lista.assertStatus(200)

    const aceptar = await client
      .post(`/api/trips/${viajeId}/offers/${Number(oferta.body().id)}/accept`)
      .header('Authorization', `Bearer ${cliente.token}`)
    aceptar.assertStatus(200)
    assert.equal(aceptar.body().estado, 'reservado')

    viaje = await Viaje.findOrFail(viajeId)
    assert.equal(viaje.estado, 'reservado')
    assert.equal(viaje.conductorId, driver.conductorId)
    assert.equal(Number(viaje.precioFinal), 480000)
    assert.isNotNull(viaje.pinEntrega)
    const esperado = parseScheduledDateTime(fecha, '08:00')!.minus({
      minutes: reservationConfig.assignedLeadMinutes,
    })
    assert.equal(viaje.activacionAt!.toMillis(), esperado.toMillis())

    // Ya asignada: desaparece de /nearby.
    const nearby2 = await client
      .get('/api/trips/nearby')
      .header('Authorization', `Bearer ${driver.token}`)
      .qs({ lat: ORIGEN.lat, lng: ORIGEN.lng })
    assert.isFalse(JSON.stringify(nearby2.body()).includes(`"id":"${viajeId}"`))
  })

  test('chat permitido entre cliente y conductor asignado; 403 a terceros', async ({
    client,
    assert,
  }) => {
    const { cliente, driver, viajeId } = await reservaAsignada(client)

    const envio = await client
      .post(`/api/trips/${viajeId}/chat`)
      .header('Authorization', `Bearer ${cliente.token}`)
      .json({ mensaje: 'Hola, ¿llevas carpa?' })
    envio.assertStatus(200)

    const lectura = await client
      .get(`/api/trips/${viajeId}/chat`)
      .header('Authorization', `Bearer ${driver.token}`)
    lectura.assertStatus(200)
    assert.isTrue(JSON.stringify(lectura.body()).includes('carpa'))

    const otro = await registerDriver(client)
    const ajeno = await client
      .get(`/api/trips/${viajeId}/chat`)
      .header('Authorization', `Bearer ${otro.token}`)
    ajeno.assertStatus(403)
  })

  test('la ruta/ubicación no se expone mientras la reserva no se active', async ({
    client,
  }) => {
    const { cliente, viajeId } = await reservaAsignada(client)
    const ruta = await client
      .get(`/api/trips/${viajeId}/route`)
      .header('Authorization', `Bearer ${cliente.token}`)
    ruta.assertStatus(404)
    ruta.assertBodyContains({ code: 'SIN_RUTA' })
  })

  test('activación: pasa a aceptado con el mismo conductor', async ({ client, assert }) => {
    const { driver, viajeId } = await reservaAsignada(client)
    await activacionVencida(viajeId)

    assert.equal(await ReservationActivationService.activar(viajeId), 'activada')

    const viaje = await Viaje.findOrFail(viajeId)
    assert.equal(viaje.estado, 'aceptado')
    assert.equal(viaje.conductorId, driver.conductorId)
    assert.isNotNull(viaje.aceptadoAt)
  })

  test('activación pospuesta si el conductor sigue ocupado', async ({ client, assert }) => {
    const { driver, viajeId } = await reservaAsignada(client)

    // Otro viaje inmediato en curso del mismo conductor.
    const otroCliente = await registerClient(client)
    const inmediato = await client
      .post('/api/trips/request')
      .header('Authorization', `Bearer ${otroCliente.token}`)
      .json({ origen: ORIGEN, destino: DESTINO, descripcion: 'Trasteo', precioCliente: 80000 })
    inmediato.assertStatus(200)
    await db
      .from('viajes')
      .where('id', Number(inmediato.body().id))
      .update({ conductor_id: driver.conductorId, estado: 'en_curso' })

    await activacionVencida(viajeId)
    assert.equal(await ReservationActivationService.activar(viajeId), 'omitida')

    const viaje = await Viaje.findOrFail(viajeId)
    assert.equal(viaje.estado, 'reservado')
    assert.equal(viaje.conductorId, driver.conductorId)
    assert.isTrue(!!viaje.avisoPospuestoEnviado)
  })

  test('el conductor suelta la reserva: se reabre sin penalización si faltan más de 24 h', async ({
    client,
    assert,
  }) => {
    const { driver, viajeId } = await reservaAsignada(client, 2)

    const sinJustificar = await client
      .post(`/api/trips/${viajeId}/cancel`)
      .header('Authorization', `Bearer ${driver.token}`)
      .json({ justificacion: 'corto' })
    sinJustificar.assertStatus(422)

    const soltar = await client
      .post(`/api/trips/${viajeId}/cancel`)
      .header('Authorization', `Bearer ${driver.token}`)
      .json({ justificacion: 'Se me dañó el vehículo y no alcanzo' })
    soltar.assertStatus(200)
    assert.equal(soltar.body().estado, 'reservado')
    assert.isTrue(soltar.body().reabierta)
    assert.isFalse(soltar.body().penalizado)

    const viaje = await Viaje.findOrFail(viajeId)
    assert.equal(viaje.estado, 'reservado')
    assert.isNull(viaje.conductorId)
    assert.isNull(viaje.precioFinal)
    assert.isNull(viaje.pinEntrega)

    const ofertas = await db.from('ofertas').where('viaje_id', viajeId).where('estado', 'aceptada')
    assert.lengthOf(ofertas, 0)
    const conductor = await db.from('conductores').where('id', driver.conductorId).first()
    assert.equal(Number(conductor.penalizacion_cancelacion ?? 0), 0)
  })

  test('el conductor suelta la reserva a menos de 24 h: se reabre con penalización', async ({
    client,
    assert,
  }) => {
    const { driver, viajeId } = await reservaAsignada(client, 2)
    // Se acerca la hora programada a 3 h (menos de 24 h).
    const pronto = DateTime.now().setZone(TZ).plus({ hours: 3 })
    await db.from('viajes').where('id', viajeId).update({
      fecha_programada: pronto.toISODate(),
      hora_programada: pronto.toFormat('HH:mm'),
    })

    const soltar = await client
      .post(`/api/trips/${viajeId}/cancel`)
      .header('Authorization', `Bearer ${driver.token}`)
      .json({ justificacion: 'Tuve una emergencia familiar' })
    soltar.assertStatus(200)
    assert.isTrue(soltar.body().penalizado)

    const conductor = await db.from('conductores').where('id', driver.conductorId).first()
    assert.equal(Number(conductor.penalizacion_cancelacion), 0.5)
    const fraude = await db.from('logs_fraude').where('conductor_id', driver.conductorId).where('tipo', 'cancelacion_conductor')
    assert.isAtLeast(fraude.length, 1)
    const viaje = await Viaje.findOrFail(viajeId)
    assert.equal(viaje.estado, 'reservado')
    assert.isNull(viaje.conductorId)
  })

  test('el cliente cancela la reserva asignada sin la regla del kilómetro', async ({
    client,
    assert,
  }) => {
    const { cliente, viajeId } = await reservaAsignada(client)

    const cancelar = await client
      .post(`/api/trips/${viajeId}/cancel`)
      .header('Authorization', `Bearer ${cliente.token}`)
      .json({ motivo: 'Ya no necesito el envío' })
    cancelar.assertStatus(200)

    const viaje = await Viaje.findOrFail(viajeId)
    assert.equal(viaje.estado, 'cancelado')
  })
})
