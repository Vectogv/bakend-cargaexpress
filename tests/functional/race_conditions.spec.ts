import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import db from '@adonisjs/lucid/services/db'
import { setTimeout } from 'node:timers/promises'

test.group('Race Condition: Double Trip Acceptance', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('two drivers cannot accept the same trip simultaneously', async ({ client, assert }) => {
    // Setup: register client
    const clientReg = await client.post('/api/auth/register').json({
      nombre: 'Race Client', apellido: 'Test',
      email: `race-client-${Date.now()}@test.com`,
      password: '123456', rol: 'cliente',
    })
    clientReg.assertStatus(200)
    const clientToken = clientReg.body().token

    // Register Driver A
    const driverAReg = await client.post('/api/auth/register').json({
      nombre: 'Driver A', apellido: 'Test',
      email: `race-driver-a-${Date.now()}@test.com`,
      password: '123456', rol: 'conductor',
      cedula: `A-${Date.now()}`, placa: `RA-${Date.now()}`,
      tipoVehiculo: 'camioneta', capacidad: '1000 kg',
    })
    driverAReg.assertStatus(200)
    const driverAToken = driverAReg.body().token
    const driverAUserId = driverAReg.body().id

    // Register Driver B
    const driverBReg = await client.post('/api/auth/register').json({
      nombre: 'Driver B', apellido: 'Test',
      email: `race-driver-b-${Date.now()}@test.com`,
      password: '123456', rol: 'conductor',
      cedula: `B-${Date.now()}`, placa: `RB-${Date.now()}`,
      tipoVehiculo: 'camioneta', capacidad: '1000 kg',
    })
    driverBReg.assertStatus(200)
    const driverBToken = driverBReg.body().token
    const driverBUserId = driverBReg.body().id

    // Verify both drivers
    await db.from('conductores').where('usuario_id', driverAUserId).update({ estado_verificacion: 'aprobado' })
    await db.from('conductores').where('usuario_id', driverBUserId).update({ estado_verificacion: 'aprobado' })

    // Set both driver locations
    await client.put('/api/drivers/location')
      .header('Authorization', `Bearer ${driverAToken}`)
      .json({ lat: 3.4516, lng: -76.5320, heading: 0, accuracy: 10 })

    await client.put('/api/drivers/location')
      .header('Authorization', `Bearer ${driverBToken}`)
      .json({ lat: 3.4516, lng: -76.5320, heading: 0, accuracy: 10 })

    // Create trip
    const trip = await client.post('/api/trips/request')
      .header('Authorization', `Bearer ${clientToken}`)
      .json({
        origen: { direccion: 'Calle 1', lat: 3.4516, lng: -76.5320 },
        destino: { direccion: 'Calle 2', lat: 3.4520, lng: -76.5310 },
        descripcion: 'race condition test', precioCliente: 50000,
      })
    trip.assertStatus(200)
    const tripId = trip.body().id

    // Simulate both drivers accepting at the same time
    const [resultA, resultB] = await Promise.all([
      client.post(`/api/trips/${tripId}/accept`)
        .header('Authorization', `Bearer ${driverAToken}`),
      client.post(`/api/trips/${tripId}/accept`)
        .header('Authorization', `Bearer ${driverBToken}`),
    ])

    // One must succeed (200), the other must fail (422 "ya fue asignado")
    const successCount = [resultA.status(), resultB.status()].filter(s => s === 200).length
    const failCount = [resultA.status(), resultB.status()].filter(s => s === 422).length

    assert.equal(successCount, 1, 'Exactly one driver should succeed')
    assert.equal(failCount, 1, 'Exactly one driver should be rejected')

    // The failing response should say "El viaje ya fue asignado"
    const failedResponse = resultA.status() === 422 ? resultA : resultB
    assert.equal(failedResponse.body().error, 'El viaje ya fue asignado')

    // Verify database consistency: only one conductor assigned
    const viaje = await db.from('viajes').where('id', tripId).first()
    assert.equal(viaje.estado, 'aceptado')
    assert.isNotNull(viaje.conductor_id, 'Trip should have a conductor assigned')

    // Verify no duplicate conductor assignments exist
    const assignedDrivers = await db.from('viajes')
      .where('id', tripId)
      .whereNotNull('conductor_id')
    assert.lengthOf(assignedDrivers, 1, 'Only one conductor should be assigned')
  }).timeout(30000)

  test('driver cannot accept an already accepted trip', async ({ client, assert }) => {
    const clientReg = await client.post('/api/auth/register').json({
      nombre: 'Client', apellido: 'Test',
      email: `client-single-${Date.now()}@test.com`,
      password: '123456', rol: 'cliente',
    })
    clientReg.assertStatus(200)
    const clientToken = clientReg.body().token

    const driverReg = await client.post('/api/auth/register').json({
      nombre: 'Driver', apellido: 'Test',
      email: `driver-single-${Date.now()}@test.com`,
      password: '123456', rol: 'conductor',
      cedula: `${Date.now()}`, placa: `DS-${Date.now()}`,
      tipoVehiculo: 'camioneta', capacidad: '1000 kg',
    })
    driverReg.assertStatus(200)
    const driverToken = driverReg.body().token
    const driverUserId = driverReg.body().id
    await db.from('conductores').where('usuario_id', driverUserId).update({ estado_verificacion: 'aprobado' })

    const driver2Reg = await client.post('/api/auth/register').json({
      nombre: 'Driver2', apellido: 'Test',
      email: `driver2-single-${Date.now()}@test.com`,
      password: '123456', rol: 'conductor',
      cedula: `${Date.now() + 1}`, placa: `DS2-${Date.now()}`,
      tipoVehiculo: 'camioneta', capacidad: '1000 kg',
    })
    driver2Reg.assertStatus(200)
    const driver2Token = driver2Reg.body().token
    const driver2UserId = driver2Reg.body().id
    await db.from('conductores').where('usuario_id', driver2UserId).update({ estado_verificacion: 'aprobado' })

    await client.put('/api/drivers/location')
      .header('Authorization', `Bearer ${driverToken}`)
      .json({ lat: 3.4516, lng: -76.5320, heading: 0, accuracy: 10 })

    const trip = await client.post('/api/trips/request')
      .header('Authorization', `Bearer ${clientToken}`)
      .json({
        origen: { direccion: 'Calle 1', lat: 3.4516, lng: -76.5320 },
        destino: { direccion: 'Calle 2', lat: 3.4520, lng: -76.5310 },
        descripcion: 'single accept', precioCliente: 50000,
      })
    trip.assertStatus(200)
    const tripId = trip.body().id

    // First driver accepts
    const accept1 = await client.post(`/api/trips/${tripId}/accept`)
      .header('Authorization', `Bearer ${driverToken}`)
    accept1.assertStatus(200)

    // Second driver tries to accept the same trip
    const accept2 = await client.post(`/api/trips/${tripId}/accept`)
      .header('Authorization', `Bearer ${driver2Token}`)

    assert.equal(accept2.status(), 422)
    assert.include(accept2.body().error, 'ya fue asignado')

    // Database must remain consistent
    const viaje = await db.from('viajes').where('id', tripId).first()
    assert.equal(viaje.estado, 'aceptado')
  }).timeout(30000)
})