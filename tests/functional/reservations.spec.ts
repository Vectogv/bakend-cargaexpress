import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'
import ConfiguracionPlataforma from '#models/configuracion_plataforma'
import ReservationActivationService from '#services/reservation_activation_service'

const TZ = 'America/Bogota'

function uniqueEmail(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 100000)}@test.com`
}

async function registerClient(client: any) {
  const res = await client.post('/api/auth/register').json({
    nombre: 'Reserva',
    apellido: 'Cliente',
    email: uniqueEmail('reserva-cliente'),
    password: '123456',
    rol: 'cliente', edad: 30,
  })
  res.assertStatus(200)
  return { token: res.body().token as string, id: res.body().id as string }
}

async function registerDriver(client: any) {
  const res = await client.post('/api/auth/register').json({
    nombre: 'Reserva',
    apellido: 'Conductor',
    email: uniqueEmail('reserva-driver'),
    password: '123456',
    rol: 'conductor', edad: 30,
    cedula: `${Date.now()}${Math.floor(Math.random() * 1000)}`,
    placa: `RS-${Date.now()}${Math.floor(Math.random() * 1000)}`,
    tipoVehiculo: 'camioneta',
    capacidad: '1000 kg',
  })
  res.assertStatus(200)
  const id = res.body().id as string
  await db.from('conductores').where('usuario_id', Number(id)).update({ estado_verificacion: 'aprobado' })
  return { token: res.body().token as string, id }
}

function reservePayload(fecha: string, hora: string) {
  return {
    origen: { direccion: 'Popayán, Cauca', lat: 2.4448, lng: -76.6147 },
    destino: { direccion: 'Cali, Valle del Cauca', lat: 3.4516, lng: -76.532 },
    descripcion: 'Mercancía general',
    precioCliente: 500000,
    fechaProgramada: fecha,
    horaProgramada: hora,
  }
}

function futureDate(days: number): string {
  return DateTime.now().setZone(TZ).plus({ days }).toISODate()!
}

/** Adelanta la ventana de activación de una reserva al pasado. */
async function forzarVentana(viajeId: string | number) {
  await db
    .from('viajes')
    .where('id', Number(viajeId))
    .update({
      activacion_at: DateTime.now().minus({ minutes: 1 }).toFormat('yyyy-MM-dd HH:mm:ss'),
    })
}

/** Fuerza la ventana y ejecuta la activación como lo haría el scheduler. */
async function activarReserva(viajeId: string | number) {
  await forzarVentana(viajeId)
  return ReservationActivationService.activar(Number(viajeId))
}

test.group('Reservas programadas', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('crea una reserva válida en estado reservado', async ({ client, assert }) => {
    const { token } = await registerClient(client)
    const fecha = futureDate(2)

    const res = await client
      .post('/api/trips/reserve')
      .header('Authorization', `Bearer ${token}`)
      .json(reservePayload(fecha, '08:00'))

    res.assertStatus(201)
    assert.equal(res.body().estado, 'reservado')
    assert.equal(res.body().tipoProgramacion, 'programada')
    assert.equal(res.body().fechaProgramada, fecha)
    assert.equal(res.body().horaProgramada, '08:00')
    assert.isNotNull(res.body().activacionAt)

    const viaje = await db.from('viajes').where('id', Number(res.body().id)).first()
    assert.equal(viaje.estado, 'reservado')
    assert.equal(viaje.tipo_programacion, 'programada')
    assert.equal(viaje.fecha_programada, fecha)
    assert.equal(viaje.hora_programada, '08:00')
    assert.isNotNull(viaje.activacion_at)
  })

  test('rechaza una reserva con fecha pasada', async ({ client }) => {
    const { token } = await registerClient(client)
    const fecha = DateTime.now().setZone(TZ).minus({ days: 1 }).toISODate()!

    const res = await client
      .post('/api/trips/reserve')
      .header('Authorization', `Bearer ${token}`)
      .json(reservePayload(fecha, '08:00'))

    res.assertStatus(400)
  })

  test('rechaza una reserva demasiado cercana (anticipación mínima)', async ({ client }) => {
    const { token } = await registerClient(client)
    const objetivo = DateTime.now().setZone(TZ).plus({ minutes: 30 })

    const res = await client
      .post('/api/trips/reserve')
      .header('Authorization', `Bearer ${token}`)
      .json(reservePayload(objetivo.toISODate()!, objetivo.toFormat('HH:mm')))

    res.assertStatus(400)
  })

  test('rechaza a un cliente inactivo', async ({ client }) => {
    const { token, id } = await registerClient(client)
    await db.from('users').where('id', Number(id)).update({ estado_cuenta: 'suspension_por_pago' })

    const res = await client
      .post('/api/trips/reserve')
      .header('Authorization', `Bearer ${token}`)
      .json(reservePayload(futureDate(2), '08:00'))

    res.assertStatus(403)
  })

  test('rechaza a un usuario que no es cliente', async ({ client }) => {
    const { token } = await registerDriver(client)

    const res = await client
      .post('/api/trips/reserve')
      .header('Authorization', `Bearer ${token}`)
      .json(reservePayload(futureDate(2), '08:00'))

    res.assertStatus(403)
  })

  test('rechaza una reserva fuera de cobertura', async ({ client }) => {
    const { token } = await registerClient(client)
    // En SQLite la columna json debe guardarse como texto.
    await ConfiguracionPlataforma.create({
      zonasCobertura: JSON.stringify([{ nombre: 'Cali', lat: 3.4516, lng: -76.532, radio: 10 }]),
    } as any)

    // El origen del payload es Popayán, a más de 10 km de Cali.
    const res = await client
      .post('/api/trips/reserve')
      .header('Authorization', `Bearer ${token}`)
      .json(reservePayload(futureDate(2), '08:00'))

    res.assertStatus(422)
  })

  test('lista las reservas programadas del cliente', async ({ client, assert }) => {
    const { token } = await registerClient(client)
    const created = await client
      .post('/api/trips/reserve')
      .header('Authorization', `Bearer ${token}`)
      .json(reservePayload(futureDate(3), '09:30'))
    created.assertStatus(201)

    const lista = await client.get('/api/trips/reservations').header('Authorization', `Bearer ${token}`)

    lista.assertStatus(200)
    assert.equal(lista.body().data.length, 1)
    assert.equal(lista.body().data[0].id, created.body().id)
    assert.equal(lista.body().data[0].tipoProgramacion, 'programada')
  })

  test('activa una reserva vencida y no la duplica', async ({ client, assert }) => {
    const { token } = await registerClient(client)
    const created = await client
      .post('/api/trips/reserve')
      .header('Authorization', `Bearer ${token}`)
      .json(reservePayload(futureDate(1), '08:00'))
    created.assertStatus(201)
    const viajeId = Number(created.body().id)

    // Antes de la ventana no debe activarse.
    assert.equal(await ReservationActivationService.activar(viajeId), 'omitida')

    await forzarVentana(viajeId)
    const porActivar = await ReservationActivationService.reservasPorActivar()
    assert.include(
      porActivar.map((v) => v.id),
      viajeId
    )

    assert.equal(await ReservationActivationService.activar(viajeId), 'activada')
    let viaje = await db.from('viajes').where('id', viajeId).first()
    assert.equal(viaje.estado, 'buscando_conductor')

    // Segunda ejecución: una reserva = una activación.
    assert.equal(await ReservationActivationService.activar(viajeId), 'omitida')
    viaje = await db.from('viajes').where('id', viajeId).first()
    assert.equal(viaje.estado, 'buscando_conductor')
  })

  test('un conductor no puede aceptar dos reservas incompatibles', async ({ client, assert }) => {
    const clienteA = await registerClient(client)
    const r1 = await client
      .post('/api/trips/reserve')
      .header('Authorization', `Bearer ${clienteA.token}`)
      .json(reservePayload(futureDate(2), '08:00'))
    r1.assertStatus(201)
    assert.equal(await activarReserva(r1.body().id), 'activada')

    const driver = await registerDriver(client)
    const aceptar1 = await client
      .post(`/api/trips/${r1.body().id}/accept`)
      .header('Authorization', `Bearer ${driver.token}`)
    aceptar1.assertStatus(200)

    const clienteB = await registerClient(client)
    const r2 = await client
      .post('/api/trips/reserve')
      .header('Authorization', `Bearer ${clienteB.token}`)
      .json(reservePayload(futureDate(2), '08:30'))
    r2.assertStatus(201)
    assert.equal(await activarReserva(r2.body().id), 'activada')

    const aceptar2 = await client
      .post(`/api/trips/${r2.body().id}/accept`)
      .header('Authorization', `Bearer ${driver.token}`)
    assert.equal(aceptar2.status(), 409)

    const viaje2 = await db.from('viajes').where('id', Number(r2.body().id)).first()
    assert.equal(viaje2.estado, 'buscando_conductor')
  })

  test('dos conductores no pueden aceptar la misma reserva', async ({ client, assert }) => {
    const cliente = await registerClient(client)
    const r1 = await client
      .post('/api/trips/reserve')
      .header('Authorization', `Bearer ${cliente.token}`)
      .json(reservePayload(futureDate(2), '10:00'))
    r1.assertStatus(201)
    assert.equal(await activarReserva(r1.body().id), 'activada')

    const driverA = await registerDriver(client)
    const driverB = await registerDriver(client)

    const aceptarA = await client
      .post(`/api/trips/${r1.body().id}/accept`)
      .header('Authorization', `Bearer ${driverA.token}`)
    aceptarA.assertStatus(200)

    const aceptarB = await client
      .post(`/api/trips/${r1.body().id}/accept`)
      .header('Authorization', `Bearer ${driverB.token}`)
    assert.equal(aceptarB.status(), 422)

    const viaje = await db.from('viajes').where('id', Number(r1.body().id)).first()
    assert.equal(viaje.estado, 'aceptado')
    assert.isNotNull(viaje.conductor_id)
  })

  test('el cliente puede cancelar una reserva antes de la búsqueda', async ({ client, assert }) => {
    const { token } = await registerClient(client)
    const r1 = await client
      .post('/api/trips/reserve')
      .header('Authorization', `Bearer ${token}`)
      .json(reservePayload(futureDate(2), '11:00'))
    r1.assertStatus(201)

    const cancel = await client
      .post(`/api/trips/${r1.body().id}/cancel`)
      .header('Authorization', `Bearer ${token}`)
      .json({ motivo: 'Cambio de planes' })

    cancel.assertStatus(200)
    assert.equal(cancel.body().estado, 'cancelado')
  })

  test('el viaje inmediato sigue funcionando igual', async ({ client, assert }) => {
    const { token } = await registerClient(client)

    const res = await client
      .post('/api/trips/request')
      .header('Authorization', `Bearer ${token}`)
      .json({
        origen: { direccion: 'Calle 1', lat: 3.4516, lng: -76.532 },
        destino: { direccion: 'Calle 2', lat: 3.452, lng: -76.531 },
        descripcion: 'carga inmediata',
        precioCliente: 50000,
      })

    res.assertStatus(200)
    assert.equal(res.body().estado, 'buscando_conductor')

    const viaje = await db.from('viajes').where('id', Number(res.body().id)).first()
    assert.equal(viaje.tipo_programacion, 'inmediata')
  })
})
