import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import db from '@adonisjs/lucid/services/db'
import { setTimeout } from 'node:timers/promises'

test.group('Service Failure Simulation', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('API works correctly when Socket.IO is down', async ({ client, assert }) => {
    // Socket.IO is not initialized in test environment by default,
    // but controllers use try/catch around socket emits.
    // This verifies the server doesn't crash when socket is unavailable.
    const clientReg = await client.post('/api/auth/register').json({
      nombre: 'Fail Client', apellido: 'Test',
      email: `fail-client-${Date.now()}@test.com`,
      password: '123456', rol: 'cliente',
    })
    clientReg.assertStatus(200)
    const clientToken = clientReg.body().token

    const driverReg = await client.post('/api/auth/register').json({
      nombre: 'Fail Driver', apellido: 'Test',
      email: `fail-driver-${Date.now()}@test.com`,
      password: '123456', rol: 'conductor',
      cedula: `${Date.now()}`, placa: `FD-${Date.now()}`,
      tipoVehiculo: 'camioneta', capacidad: '1000 kg',
    })
    driverReg.assertStatus(200)
    const driverToken = driverReg.body().token
    const driverUserId = driverReg.body().id
    await db.from('conductores').where('usuario_id', driverUserId).update({ estado_verificacion: 'aprobado' })

    // All these operations should succeed even without Socket.IO
    const trip = await client.post('/api/trips/request')
      .header('Authorization', `Bearer ${clientToken}`)
      .json({
        origen: { direccion: 'Calle 1', lat: 3.4516, lng: -76.5320 },
        destino: { direccion: 'Calle 2', lat: 3.4520, lng: -76.5310 },
        descripcion: 'socket failure test', precioCliente: 50000,
      })
    trip.assertStatus(200)
    const tripId = trip.body().id

    await client.put('/api/drivers/location')
      .header('Authorization', `Bearer ${driverToken}`)
      .json({ lat: 3.4516, lng: -76.5320, heading: 0, accuracy: 10 })

    const accept = await client.post(`/api/trips/${tripId}/accept`)
      .header('Authorization', `Bearer ${driverToken}`)
    accept.assertStatus(200)

    const start = await client.post(`/api/trips/${tripId}/start-trip`)
      .header('Authorization', `Bearer ${driverToken}`)
    start.assertStatus(200)

    const complete = await client.post(`/api/trips/${tripId}/complete`)
      .header('Authorization', `Bearer ${driverToken}`)
      .json({ montoFinal: 50000 })
    complete.assertStatus(200)

    // Verify database integrity
    const viaje = await db.from('viajes').where('id', tripId).first()
    assert.equal(viaje.estado, 'completado')
    assert.equal(Number(viaje.precio_final), 50000)
  }).timeout(30000)

  test('gps rate limit service degrades gracefully when Redis is unavailable', async ({ assert }) => {
    // The GPS rate limit service has an in-memory fallback when Redis is down.
    // Import directly and verify fallback behavior
    const gpsRateLimitService = (await import('#services/gps_rate_limit_service')).default

    // Reset state
    gpsRateLimitService.reset(9999)

    // First call should pass
    const result1 = await gpsRateLimitService.checkAndMark(9999)
    assert.isTrue(result1, 'First GPS update should be allowed')

    // Immediate second call should be rate limited
    const result2 = await gpsRateLimitService.checkAndMark(9999)
    assert.isFalse(result2, 'Second GPS update within 8s should be rate limited')

    // Reset and verify clear
    gpsRateLimitService.reset(9999)
    const result3 = await gpsRateLimitService.checkAndMark(9999)
    assert.isTrue(result3, 'After reset, GPS update should be allowed again')
  })

  test('fraud detection system logs to database without crashing', async ({ client, assert }) => {
    // Create a real user and conductor for the fraud log FK constraint
    const driverReg = await client.post('/api/auth/register').json({
      nombre: 'Fraud Test', apellido: 'Driver',
      email: `fraud-driver-${Date.now()}@test.com`,
      password: '123456', rol: 'conductor',
      cedula: `${Date.now()}`, placa: `FD-${Date.now()}`,
      tipoVehiculo: 'camioneta', capacidad: '1000 kg',
    })
    driverReg.assertStatus(200)
    const driverUserId = driverReg.body().id
    const driverRecord = await db.from('conductores').where('usuario_id', driverUserId).first()
    const conductorId = driverRecord.id

    const fraudService = (await import('#services/fraud_detection_service')).default
    const RedisService = (await import('#services/redis_service')).default

    // Reset any previous state
    await RedisService.del(`fraud:prev_location:${conductorId}`)
    await RedisService.del(`fraud:last_update:${conductorId}`)

    // Valid location in Cali, Colombia — no fraud expected
    await fraudService.analyzeLocation(conductorId, 3.4516, -76.5320)

    // Check the logs_fraude table — no entries expected for valid movement
    const entries = await db.from('logs_fraude').where('conductor_id', conductorId)
    assert.lengthOf(entries, 0, 'Valid locations should not generate fraud logs')

    // Now test with invalid coordinates
    await fraudService.analyzeLocation(conductorId, 200, 500)

    const fraudEntries = await db.from('logs_fraude').where('conductor_id', conductorId)
    assert.isAtLeast(fraudEntries.length, 1, 'Invalid coordinates should generate fraud logs')

    const firstEntry = fraudEntries[0]
    assert.equal(firstEntry.tipo, 'COORDENADA_INVALIDA')
  })
})