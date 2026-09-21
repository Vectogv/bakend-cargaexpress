import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'
import ReservationActivationService from '#services/reservation_activation_service'

const TZ = 'America/Bogota'

function uniqueEmail(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 100000)}@test.com`
}

async function registerClient(client: any) {
  const res = await client.post('/api/auth/register').json({
    nombre: 'E2E',
    apellido: 'Cliente',
    email: uniqueEmail('e2e-cliente'),
    password: '123456',
    rol: 'cliente', edad: 30,
  })
  res.assertStatus(200)
  return { token: res.body().token as string, id: res.body().id as string }
}

async function registerDriver(client: any) {
  const res = await client.post('/api/auth/register').json({
    nombre: 'E2E',
    apellido: 'Conductor',
    email: uniqueEmail('e2e-driver'),
    password: '123456',
    rol: 'conductor', edad: 30,
    cedula: `${Date.now()}${Math.floor(Math.random() * 1000)}`,
    placa: `E2E-${Date.now()}${Math.floor(Math.random() * 1000)}`,
    tipoVehiculo: 'camioneta',
    capacidad: '1000 kg',
  })
  res.assertStatus(200)
  const id = res.body().id as string
  await db.from('conductores').where('usuario_id', Number(id)).update({
    estado_verificacion: 'aprobado',
    // H2: ubicación reciente dentro del radio de oferta (origen de la reserva).
    ultima_ubicacion_lat: 2.4448,
    ultima_ubicacion_lng: -76.6147,
    updated_at: DateTime.now().toSQL(),
    ubicacion_actualizada_en: DateTime.now().toSQL(),
  })
  const conductor = await db.from('conductores').where('usuario_id', Number(id)).first()
  return { token: res.body().token as string, id, conductorId: Number(conductor.id) }
}

async function crearReservaActivada(client: any, token: string) {
  const fecha = DateTime.now().setZone(TZ).plus({ days: 2 }).toISODate()!
  const res = await client
    .post('/api/trips/reserve')
    .header('Authorization', `Bearer ${token}`)
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
  await db
    .from('viajes')
    .where('id', viajeId)
    .update({ activacion_at: DateTime.now().minus({ minutes: 1 }).toFormat('yyyy-MM-dd HH:mm:ss') })
  await ReservationActivationService.activar(viajeId)

  return viajeId
}

test.group('Reserva E2E (flujo real conductor -> cliente)', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('el conductor oferta y el cliente acepta; una segunda aceptación es rechazada', async ({
    client,
    assert,
  }) => {
    const cliente = await registerClient(client)
    const viajeId = await crearReservaActivada(client, cliente.token)

    const driver = await registerDriver(client)

    // El conductor crea la oferta (flujo real, no una "oferta del sistema")
    const oferta = await client
      .post(`/api/trips/${viajeId}/offers`)
      .header('Authorization', `Bearer ${driver.token}`)
      .json({ monto: 480000 })
    oferta.assertStatus(201)
    const ofertaId = Number(oferta.body().id)

    let viaje = await db.from('viajes').where('id', viajeId).first()
    assert.equal(viaje.estado, 'pendiente')

    // El cliente acepta
    const aceptar = await client
      .post(`/api/trips/${viajeId}/offers/${ofertaId}/accept`)
      .header('Authorization', `Bearer ${cliente.token}`)
    aceptar.assertStatus(200)
    assert.equal(aceptar.body().estado, 'aceptado')
    assert.equal(aceptar.body().conductorId, String(driver.conductorId))

    viaje = await db.from('viajes').where('id', viajeId).first()
    assert.equal(viaje.estado, 'aceptado')
    assert.equal(Number(viaje.precio_final), 480000)

    // Segunda aceptación de la misma oferta: rechazada por el lock/re-validación
    const aceptar2 = await client
      .post(`/api/trips/${viajeId}/offers/${ofertaId}/accept`)
      .header('Authorization', `Bearer ${cliente.token}`)
    assert.equal(aceptar2.status(), 400)

    viaje = await db.from('viajes').where('id', viajeId).first()
    assert.equal(viaje.estado, 'aceptado')
  })

  test('E2E: reserva activada -> oferta -> aceptado -> finalizado', async ({ client, assert }) => {
    const cliente = await registerClient(client)
    const viajeId = await crearReservaActivada(client, cliente.token)
    const driver = await registerDriver(client)

    const oferta = await client
      .post(`/api/trips/${viajeId}/offers`)
      .header('Authorization', `Bearer ${driver.token}`)
      .json({ monto: 500000 })
    oferta.assertStatus(201)

    const aceptar = await client
      .post(`/api/trips/${viajeId}/offers/${Number(oferta.body().id)}/accept`)
      .header('Authorization', `Bearer ${cliente.token}`)
    aceptar.assertStatus(200)

    const enCamino = await client
      .post(`/api/trips/${viajeId}/confirm-arrival`)
      .header('Authorization', `Bearer ${driver.token}`)
    enCamino.assertStatus(200)

    // Conductor llega al origen de la reserva (requerido por la regla antifraude R2)
    await db.from('conductores').where('id', driver.conductorId).update({
      ultima_ubicacion_lat: 2.4448,
      ultima_ubicacion_lng: -76.6147,
      updated_at: DateTime.now().toSQL(),
      ubicacion_actualizada_en: DateTime.now().toSQL(),
    })

    const llegada = await client
      .post(`/api/trips/${viajeId}/confirm-pickup`)
      .header('Authorization', `Bearer ${driver.token}`)
    llegada.assertStatus(200)

    const enCurso = await client
      .post(`/api/trips/${viajeId}/start-trip`)
      .header('Authorization', `Bearer ${driver.token}`)
    enCurso.assertStatus(200)

    // Conductor llega al destino antes de cerrar el servicio (regla antifraude R3)
    await db.from('conductores').where('id', driver.conductorId).update({
      ultima_ubicacion_lat: 3.4516,
      ultima_ubicacion_lng: -76.532,
      updated_at: DateTime.now().toSQL(),
      ubicacion_actualizada_en: DateTime.now().toSQL(),
    })

    const completo = await client
      .post(`/api/trips/${viajeId}/complete`)
      .header('Authorization', `Bearer ${driver.token}`)
      .json({ montoFinal: 500000 })
    completo.assertStatus(200)

    let viaje = await db.from('viajes').where('id', viajeId).first()
    assert.equal(viaje.estado, 'pendiente_confirmacion')

    const finalizado = await client
      .post(`/api/trips/${viajeId}/confirm-close`)
      .header('Authorization', `Bearer ${cliente.token}`)
      .json({ confirmar: true })
    finalizado.assertStatus(200)
    assert.equal(finalizado.body().estado, 'finalizado')

    viaje = await db.from('viajes').where('id', viajeId).first()
    assert.equal(viaje.estado, 'finalizado')
    assert.equal(viaje.tipo_programacion, 'programada')

    // La reserva terminó exactamente por el mismo flujo que un viaje inmediato.
    const ganancia = await db.from('ganancias').where('viaje_id', viajeId).first()
    assert.isNotNull(ganancia)
  })
})
