import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'
import User from '#models/user'
import Notificacion from '#models/notificacion'
import ConfirmacionTimeoutService from '#services/confirmacion_timeout_service'

const ORIGEN = { lat: 3.4516, lng: -76.532 }
const DESTINO = { lat: 3.452, lng: -76.531 }
// La ciudad se fija en el conductor para resolver la zona del viaje (H1).
const ZONA = 'ZonaTest'

function email(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 100000000)}@test.com`
}

function latKm(base: number, km: number) {
  return base + km / 111
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

// Conductor recoge (en_curso) y cierra el servicio: el viaje queda
// 'pendiente_confirmacion' esperando la confirmación del cliente.
async function viajePendienteConfirmacion(client: any, clientToken: string, driver: any) {
  const tripId = await crearViaje(client, clientToken)
  await aceptarViaje(client, driver.token, tripId)

  await fijarUbicacion(driver.conductorId, ORIGEN.lat, ORIGEN.lng)
  const inicio = await client
    .post(`/api/trips/${tripId}/start-trip`)
    .header('Authorization', `Bearer ${driver.token}`)
  inicio.assertStatus(200)

  await fijarUbicacion(driver.conductorId, DESTINO.lat, DESTINO.lng)
  const completo = await client
    .post(`/api/trips/${tripId}/complete`)
    .header('Authorization', `Bearer ${driver.token}`)
    .json({ montoFinal: 50000 })
  completo.assertStatus(200)

  return tripId
}

test.group('H3 - Registro exige edad (>= 18)', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('registro sin edad es rechazado (422)', async ({ client }) => {
    const res = await client.post('/api/auth/register').json({
      nombre: 'Sin',
      apellido: 'Edad',
      email: email('hf-sinedad'),
      password: '123456',
      rol: 'cliente',
    } as any)
    res.assertStatus(422)
  })

  test('registro con edad menor a 18 es rechazado (422)', async ({ client }) => {
    const res = await client.post('/api/auth/register').json({
      nombre: 'Menor',
      apellido: 'Edad',
      email: email('hf-menor'),
      password: '123456',
      rol: 'cliente',
      edad: 17,
    })
    res.assertStatus(422)
  })

  test('registro con edad valida se acepta (200)', async ({ client, assert }) => {
    const res = await client.post('/api/auth/register').json({
      nombre: 'Adulto',
      apellido: 'Edad',
      email: email('hf-adulto'),
      password: '123456',
      rol: 'cliente',
      edad: 19,
    } as any)
    res.assertStatus(200)
    assert.isDefined(res.body().token, 'El registro válido debe devolver token')

    const user = await db.from('users').where('email', res.body().email).first()
    assert.equal(user.edad, 19, 'La edad debe persistirse en el usuario')
  })
})

test.group('H2 - Oferta solo con ubicación reciente dentro del radio', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('conductor sin ubicación NO_RECIENTE: oferta rechazada (422 UBICACION_NO_RECIENTE)', async ({ client }) => {
    const cliente = await registerClient(client)
    const driver = await registerDriver(client)
    const tripId = await crearViaje(client, cliente.token)

    const oferta = await client
      .post(`/api/trips/${tripId}/offers`)
      .header('Authorization', `Bearer ${driver.token}`)
      .json({ monto: 45000 })
    oferta.assertStatus(422)
    oferta.assertBodyContains({ code: 'UBICACION_NO_RECIENTE' })
  })

  test('conductor a mas de radioOfertaKm: oferta rechazada (422 FUERA_DE_ZONA)', async ({ client, assert }) => {
    const cliente = await registerClient(client)
    const driver = await registerDriver(client)
    await fijarUbicacion(driver.conductorId, latKm(ORIGEN.lat, 30), ORIGEN.lng)
    const tripId = await crearViaje(client, cliente.token)

    const oferta = await client
      .post(`/api/trips/${tripId}/offers`)
      .header('Authorization', `Bearer ${driver.token}`)
      .json({ monto: 45000 })
    oferta.assertStatus(422)
    oferta.assertBodyContains({ code: 'FUERA_DE_ZONA' })
    assert.isAbove(oferta.body().distanciaKm, 20)
  })

  test('conductor dentro del radio: oferta aceptada (201)', async ({ client }) => {
    const cliente = await registerClient(client)
    const driver = await registerDriver(client)
    await fijarUbicacion(driver.conductorId, ORIGEN.lat, ORIGEN.lng)
    const tripId = await crearViaje(client, cliente.token)

    const oferta = await client
      .post(`/api/trips/${tripId}/offers`)
      .header('Authorization', `Bearer ${driver.token}`)
      .json({ monto: 45000 })
    oferta.assertStatus(201)
  })
})

test.group('H5 - Recogida dentro del radio (radioRecogidaKm)', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('conductor lejos del origen no puede iniciar el viaje (422 FUERA_DE_RANGO_ORIGEN)', async ({ client, assert }) => {
    const cliente = await registerClient(client)
    const driver = await registerDriver(client)
    await fijarUbicacion(driver.conductorId, latKm(ORIGEN.lat, 5), ORIGEN.lng)
    const tripId = await crearViaje(client, cliente.token)
    await aceptarViaje(client, driver.token, tripId)

    const inicio = await client
      .post(`/api/trips/${tripId}/start-trip`)
      .header('Authorization', `Bearer ${driver.token}`)
    inicio.assertStatus(422)
    inicio.assertBodyContains({ code: 'FUERA_DE_RANGO_ORIGEN' })

    const fraude = await db.from('logs_fraude').where('tipo', 'recogida_fuera_de_origen').first()
    assert.isNotNull(fraude, 'El intento debe quedar registrado en log_fraudes')
  })

  test('conductor en el origen inicia el viaje (200 en_curso)', async ({ client }) => {
    const cliente = await registerClient(client)
    const driver = await registerDriver(client)
    await fijarUbicacion(driver.conductorId, ORIGEN.lat, ORIGEN.lng)
    const tripId = await crearViaje(client, cliente.token)
    await aceptarViaje(client, driver.token, tripId)

    const inicio = await client
      .post(`/api/trips/${tripId}/start-trip`)
      .header('Authorization', `Bearer ${driver.token}`)
    inicio.assertStatus(200)
    inicio.assertBodyContains({ estado: 'en_curso' })
  })
})

test.group('H4 - Penalización al cancelar un viaje asignado', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('conductor cancela con justificación: reputación -0.5', async ({ client, assert }) => {
    const cliente = await registerClient(client)
    const driver = await registerDriver(client)
    await fijarUbicacion(driver.conductorId, ORIGEN.lat, ORIGEN.lng)
    const tripId = await crearViaje(client, cliente.token)
    await aceptarViaje(client, driver.token, tripId)

    const antes = await db.from('users').where('id', driver.userId).first()
    const reputacionAntes = Number(antes.reputacion)

    const res = await client
      .post(`/api/trips/${tripId}/cancel`)
      .header('Authorization', `Bearer ${driver.token}`)
      .json({ justificacion: 'Falla mecánica del vehículo antes de la recogida.' })
    res.assertStatus(200)

    const despues = await db.from('users').where('id', driver.userId).first()
    assert.equal(Number(despues.reputacion), Math.max(1.0, reputacionAntes - 0.5))
  })
})

test.group('H6 - Disputa desde pendiente_confirmacion', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('cliente puede abrir disputa con el cierre sin confirmar (201)', async ({ client, assert }) => {
    const cliente = await registerClient(client)
    const driver = await registerDriver(client)
    const tripId = await viajePendienteConfirmacion(client, cliente.token, driver)

    const res = await client
      .post('/api/disputes')
      .header('Authorization', `Bearer ${cliente.token}`)
      .json({
        tripId,
        problema: 'cobro_incorrecto',
        descripcion: 'El monto cobrado no coincide con lo acordado en la oferta.',
      })
    res.assertStatus(201)
    assert.isDefined((res.body() as any).id, 'La disputa debe devolver su id')

    const disputa = await db.from('disputas').where('viaje_id', tripId).first()
    assert.isNotNull(disputa)
    assert.equal(disputa.problema, 'cobro_incorrecto')
  })
})

test.group('H1 - Cierre sin confirmar notifica y se resuelve', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  async function crearModerador(client: any, zona: string | null) {
    const user = await User.create({
      nombre: 'Mod',
      apellido: 'QA',
      email: email('hf-mod'),
      password: '123456',
      rol: 'moderador',
      esModerador: true,
      zonaModerador: zona,
    })
    const login = await client.post('/api/auth/login').json({ email: user.email, password: '123456' })
    login.assertStatus(200)
    return { token: login.body().token as string, id: user.id }
  }

  test('viaje vencido notifica al moderador de la zona y se finaliza', async ({ client, assert }) => {
    const cliente = await registerClient(client)
    const driver = await registerDriver(client)
    await db.from('conductores').where('id', driver.conductorId).update({ ciudad: ZONA })
    const moderador = await crearModerador(client, ZONA)

    const tripId = await viajePendienteConfirmacion(client, cliente.token, driver)

    // Simular que el plazo de confirmación ya venció (confirmacionTimeoutMin = 10 min).
    await db.from('viajes').where('id', tripId).update({
      pendiente_confirmacion_desde: DateTime.now().minus({ minutes: 20 }).toSQL(),
    })

    const notificados = await ConfirmacionTimeoutService.notificarConfirmacionesVencidas()
    assert.isAtLeast(notificados, 1, 'El barrido debe notificar el viaje vencido')

    const viaje = await db.from('viajes').where('id', tripId).first()
    assert.isNotNull(viaje.moderador_notificado_en, 'Debe marcarse la fecha de notificación al moderador')

    const notif = await Notificacion.query()
      .where('usuario_id', moderador.id)
      .where('tipo', 'pendiente_cierre')
      .first()
    assert.isNotNull(notif, 'El moderador debe recibir la notificación pendiente_cierre')

    // Moderador de otra zona no puede resolverlo (403)
    const otroModerador = await crearModerador(client, 'OtraZona')
    const rechazado = await client
      .post(`/api/moderator/trips/${tripId}/resolve-close`)
      .header('Authorization', `Bearer ${otroModerador.token}`)
      .json({ resolucion: 'finalizar', nota: 'El cliente no respondió el cierre indicado.' })
    rechazado.assertStatus(403)

    // El moderador de la zona finaliza el viaje sin confirmación del cliente (200)
    const resuelto = await client
      .post(`/api/moderator/trips/${tripId}/resolve-close`)
      .header('Authorization', `Bearer ${moderador.token}`)
      .json({ resolucion: 'finalizar', nota: 'El cliente no respondió el cierre indicado.' })
    resuelto.assertStatus(200)
    resuelto.assertBodyContains({ estado: 'finalizado' })

    const viajeFinal = await db.from('viajes').where('id', tripId).first()
    assert.equal(viajeFinal.estado, 'finalizado')
    assert.equal(Number(viajeFinal.precio_final), 50000)

    const ganancia = await db.from('ganancias').where('viaje_id', tripId).first()
    assert.isNotNull(ganancia, 'La finalización por moderador debe generar la ganancia')
  })

  test('moderador sin zona asignada no puede resolver (403)', async ({ client }) => {
    const cliente = await registerClient(client)
    const driver = await registerDriver(client)
    await db.from('conductores').where('id', driver.conductorId).update({ ciudad: ZONA })
    const moderador = await crearModerador(client, null)
    const tripId = await viajePendienteConfirmacion(client, cliente.token, driver)

    const rechazado = await client
      .post(`/api/moderator/trips/${tripId}/resolve-close`)
      .header('Authorization', `Bearer ${moderador.token}`)
      .json({ resolucion: 'finalizar', nota: 'El cliente no respondió el cierre indicado.' })
    rechazado.assertStatus(403)
    // El moderator_middleware bloquea antes de llegar al controlador a los
    // moderadores sin zonaModerador (cambio intencional).
    rechazado.assertBodyContains({ error: 'No tienes ciudad asignada. Contacta al administrador.' })
  })

  test('zona del moderador con distinto case coincide con la del viaje (200)', async ({ client }) => {
    const cliente = await registerClient(client)
    const driver = await registerDriver(client)
    // La ciudad del conductor se resuelve tal cual, p.ej. 'cali'; el moderador la tiene como 'Cali'.
    await db.from('conductores').where('id', driver.conductorId).update({ ciudad: 'cali' })
    const moderador = await crearModerador(client, 'Cali')
    const tripId = await viajePendienteConfirmacion(client, cliente.token, driver)

    const resuelto = await client
      .post(`/api/moderator/trips/${tripId}/resolve-close`)
      .header('Authorization', `Bearer ${moderador.token}`)
      .json({ resolucion: 'finalizar', nota: 'El cliente no respondió el cierre indicado.' })
    resuelto.assertStatus(200)
    resuelto.assertBodyContains({ estado: 'finalizado' })
  })

  test('nota corta y resolución inválida son rechazadas', async ({ client }) => {
    const cliente = await registerClient(client)
    const driver = await registerDriver(client)
    await db.from('conductores').where('id', driver.conductorId).update({ ciudad: ZONA })
    const moderador = await crearModerador(client, ZONA)
    const tripId = await viajePendienteConfirmacion(client, cliente.token, driver)

    const sinNota = await client
      .post(`/api/moderator/trips/${tripId}/resolve-close`)
      .header('Authorization', `Bearer ${moderador.token}`)
      .json({ resolucion: 'finalizar', nota: 'breve' })
    sinNota.assertStatus(422)

    const resolucionInvalida = await client
      .post(`/api/moderator/trips/${tripId}/resolve-close`)
      .header('Authorization', `Bearer ${moderador.token}`)
      .json({ resolucion: 'eliminar', nota: 'Resolución no contemplada en el sistema.' })
    resolucionInvalida.assertStatus(422)
  })

  test('moderador deriva el cierre sin confirmar a disputa (200)', async ({ client, assert }) => {
    const cliente = await registerClient(client)
    const driver = await registerDriver(client)
    await db.from('conductores').where('id', driver.conductorId).update({ ciudad: ZONA })
    const moderador = await crearModerador(client, ZONA)
    const tripId = await viajePendienteConfirmacion(client, cliente.token, driver)

    const resuelto = await client
      .post(`/api/moderator/trips/${tripId}/resolve-close`)
      .header('Authorization', `Bearer ${moderador.token}`)
      .json({ resolucion: 'disputa', nota: 'El cliente alega un monto incorrecto en el cierre.' })
    resuelto.assertStatus(200)
    resuelto.assertBodyContains({ estado: 'disputa' })

    const viaje = await db.from('viajes').where('id', tripId).first()
    assert.equal(viaje.estado, 'disputa')

    const disputa = await db.from('disputas').where('viaje_id', tripId).first()
    assert.isNotNull(disputa)
    assert.equal(disputa.problema, 'cierre_sin_confirmar')

    const notifCliente = await Notificacion.query()
      .where('usuario_id', cliente.id)
      .where('tipo', 'disputa_cierre')
      .first()
    assert.isNotNull(notifCliente, 'El cliente debe recibir la notificación de disputa')
  })
})