import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import db from '@adonisjs/lucid/services/db'
import { io } from 'socket.io-client'
import { setTimeout } from 'node:timers/promises'
import GpsRateLimitService from '#services/gps_rate_limit_service'

// Puerto real del servidor de tests: `node ace test` usa otro aleatorio si
// el 3333 está ocupado (p. ej. por un `node ace serve` de desarrollo).
const SOCKET_URL = `http://localhost:${process.env.PORT ?? 3333}`

// Resets the (in-memory / Redis) GPS rate limiter for a conductor so that a
// fresh location PUT always succeeds even when conductor IDs are reused
// after transaction rollbacks.
async function resetGpsLimiter(driverUserId: number) {
  const conductor = await db.from('conductores').where('usuario_id', driverUserId).first()
  await GpsRateLimitService.reset(conductor.id)
}

// Helper function to simulate driver location via HTTP
async function simulateDriverHttpMovement(
  client: any,
  driverToken: string,
  _tripId: number,
  start: { lat: number; lng: number },
  end: { lat: number; lng: number },
  steps = 5
) {
  for (let i = 0; i <= steps; i++) {
    const progress = i / steps
    const lat = start.lat + (end.lat - start.lat) * progress
    const lng = start.lng + (end.lng - start.lng) * progress
    
    await client.put('/api/drivers/location')
      .header('Authorization', `Bearer ${driverToken}`)
      .json({ lat, lng, heading: 0, accuracy: 10 })
    
    await setTimeout(800) // Update every 800ms
  }
}

test.group('Trip Flow QA Test', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())
  
  test('Complete trip flow simulation', async ({ client, assert }) => {
    // 1. Client login
    const clientRegister = await client.post('/api/auth/register').json({
      nombre: 'QA Client',
      apellido: 'Test',
      email: 'qaclient@test.com',
      password: '123456',
      rol: 'cliente', edad: 30
    })
    clientRegister.assertStatus(200)
    const clientToken = clientRegister.body().token
    
    // 2. Driver login
    const driverRegister = await client.post('/api/auth/register').json({
      nombre: 'QA Driver',
      apellido: 'Test',
      email: `qadriver-${Date.now()}@test.com`,
      password: '123456',
      rol: 'conductor', edad: 30,
      cedula: `${Date.now()}`,
      placa: `QA-${Date.now()}`,
      tipoVehiculo: 'camioneta',
      capacidad: '1000 kg'
    })
    driverRegister.assertStatus(200)
    const driverToken = driverRegister.body().token
    const driverUserId = driverRegister.body().id
    
    // Fix: Set driver as verified in the database
    await db.from('conductores').where('usuario_id', driverUserId).update({ 
      estado_verificacion: 'aprobado' 
    })
    
    // 3. Client creates trip
    const tripCreation = await client.post('/api/trips/request')
      .header('Authorization', `Bearer ${clientToken}`)
      .json({
        origen: { 
          direccion: 'Calle 1', 
          lat: 3.4516, 
          lng: -76.5320 
        },
        destino: { 
          direccion: 'Calle 2', 
          lat: 3.4520, 
          lng: -76.5310 
        },
        descripcion: 'carga de prueba',
        precioCliente: 50000
      })
    tripCreation.assertStatus(200)
    const tripId = tripCreation.body().id
    
    // 4. Set driver location
    await resetGpsLimiter(driverUserId)
    const locationRes = await client.put('/api/drivers/location')
      .header('Authorization', `Bearer ${driverToken}`)
      .json({ 
        lat: 3.4516, 
        lng: -76.5320,
        heading: 0,
        accuracy: 10
      })
    locationRes.assertStatus(200)
    
    // Fix: Use query param for socket auth (server reads from query.token)
    const clientSocket = io(SOCKET_URL, {
      query: { token: clientToken }
    })
    
    const driverSocket = io(SOCKET_URL, {
      query: { token: driverToken }
    })
    
    // Track events with event name + payload
    const clientEvents: Array<{ event: string; id?: string; estado?: string; lat?: number; lng?: number }> = []
    
    clientSocket.on('trip:accepted', (data: any) => clientEvents.push({ event: 'trip:accepted', id: data.id, estado: data.estado }))
    clientSocket.on('trip:started', (data: any) => clientEvents.push({ event: 'trip:started', id: data.id, estado: data.estado }))
    clientSocket.on('trip:finalized', (data: any) => clientEvents.push({ event: 'trip:finalized', id: data.id, estado: data.estado }))
    clientSocket.on('driver:location', (data: any) => clientEvents.push({ event: 'driver:location', lat: data.lat, lng: data.lng }))
    
    driverSocket.on('trip:nearby', (data: any) => console.log('Driver received trip:nearby', data))
    
    // 5. Driver accepts trip
    await setTimeout(1000) // Wait for trip propagation
    const tripAccept = await client.post(`/api/trips/${tripId}/accept`)
      .header('Authorization', `Bearer ${driverToken}`)
    tripAccept.assertStatus(200)
    
    // 6. Verify trip accepted in database
    let viaje = await db.from('viajes').where('id', tripId).first()
    assert.equal(viaje.estado, 'aceptado')
    
    // 7. Driver starts trip
    const tripStart = await client.post(`/api/trips/${tripId}/start-trip`)
      .header('Authorization', `Bearer ${driverToken}`)
    tripStart.assertStatus(200)
    
    // 8. Verify trip started in database
    viaje = await db.from('viajes').where('id', tripId).first()
    assert.equal(viaje.estado, 'en_curso')
    
    // 9. Simulate GPS updates via HTTP
    await simulateDriverHttpMovement(
      client,
      driverToken,
      tripId,
      { lat: 3.4516, lng: -76.5320 },
      { lat: 3.4520, lng: -76.5310 }
    )
    
    // 10. Verify GPS logs in database (rate-limited to 1 per 8 seconds)
    const gpsLogs = await db.from('ubicaciones_drivers')
      .join('conductores', 'ubicaciones_drivers.conductor_id', 'conductores.id')
      .where('conductores.usuario_id', driverUserId)
    assert.isAtLeast(gpsLogs.length, 1, 'Should have at least one GPS log entry')
    
    // Verify driver's last location was updated
    const driverRecord = await db.from('conductores').where('usuario_id', driverUserId).first()
    assert.isNotNull(driverRecord.ultima_ubicacion_lat)
    assert.isNotNull(driverRecord.ultima_ubicacion_lng)
    
    // 11. Complete trip (conductor within range -> waiting for client confirmation)
    const tripComplete = await client.post(`/api/trips/${tripId}/complete`)
      .header('Authorization', `Bearer ${driverToken}`)
      .json({ montoFinal: 50000 })
    tripComplete.assertStatus(200)
    
    // 12. Verify trip completed in database (pending client confirmation)
    viaje = await db.from('viajes').where('id', tripId).first()
    assert.equal(viaje.estado, 'pendiente_confirmacion')
    assert.equal(Number(viaje.precio_final), 50000)

    // 13. Client confirms closure -> trip finalized
    const confirmClose = await client.post(`/api/trips/${tripId}/confirm-close`)
      .header('Authorization', `Bearer ${clientToken}`)
      .json({ confirmar: true })
    confirmClose.assertStatus(200)
    assert.equal(confirmClose.body().estado, 'finalizado')

    viaje = await db.from('viajes').where('id', tripId).first()
    assert.equal(viaje.estado, 'finalizado')
    
    // Cleanup sockets (if connected)
    try { clientSocket.disconnect() } catch {}
    try { driverSocket.disconnect() } catch {}
  }).timeout(60000)

  test('Socket fallback and HTTP polling', async ({ client, assert }) => {
    // Register client and driver
    const clientReg = await client.post('/api/auth/register').json({
      nombre: 'Fallback Client', apellido: 'Test',
      email: `fallback-client-${Date.now()}@test.com`,
      password: '123456', rol: 'cliente', edad: 30
    })
    clientReg.assertStatus(200)
    const clientToken = clientReg.body().token
    
    const driverReg = await client.post('/api/auth/register').json({
      nombre: 'Fallback Driver', apellido: 'Test',
      email: `fallback-driver-${Date.now()}@test.com`,
      password: '123456', rol: 'conductor', edad: 30,
      cedula: `${Date.now()}`, placa: `FB-${Date.now()}`,
      tipoVehiculo: 'camioneta', capacidad: '1000 kg'
    })
    driverReg.assertStatus(200)
    const driverToken = driverReg.body().token
    const driverUserId = driverReg.body().id
    
    // Verify driver
    await db.from('conductores').where('usuario_id', driverUserId).update({ 
      estado_verificacion: 'aprobado' 
    })
    
    // Create trip
    const trip = await client.post('/api/trips/request')
      .header('Authorization', `Bearer ${clientToken}`)
      .json({
        origen: { direccion: 'Calle 1', lat: 3.4516, lng: -76.5320 },
        destino: { direccion: 'Calle 2', lat: 3.4520, lng: -76.5310 },
        descripcion: 'fallback test', precioCliente: 50000
      })
    trip.assertStatus(200)
    const tripId = trip.body().id
    
    // Driver accepts via HTTP (intentionally not using socket)
    await resetGpsLimiter(driverUserId)
    const locationRes = await client.put('/api/drivers/location')
      .header('Authorization', `Bearer ${driverToken}`)
      .json({ lat: 3.4516, lng: -76.5320, heading: 0, accuracy: 10 })
    locationRes.assertStatus(200)
    
    await setTimeout(500)
    const accept = await client.post(`/api/trips/${tripId}/accept`)
      .header('Authorization', `Bearer ${driverToken}`)
    accept.assertStatus(200)
    
    // Verify trip state via HTTP (polling fallback simulation)
    const activeTrip = await client.get('/api/trips/active')
      .header('Authorization', `Bearer ${clientToken}`)
    activeTrip.assertStatus(200)
    assert.equal(activeTrip.body().estado, 'aceptado')
    assert.equal(activeTrip.body().id, String(tripId))
    
    // Complete trip via HTTP (no socket needed)
    const tripStart = await client.post(`/api/trips/${tripId}/start-trip`)
      .header('Authorization', `Bearer ${driverToken}`)
    tripStart.assertStatus(200)
    
    const tripComplete = await client.post(`/api/trips/${tripId}/complete`)
      .header('Authorization', `Bearer ${driverToken}`)
      .json({ montoFinal: 50000 })
    tripComplete.assertStatus(200)

    // Final verification via database: pending client confirmation
    const viajeDb = await db.from('viajes').where('id', tripId).first()
    assert.equal(viajeDb.estado, 'pendiente_confirmacion')
    assert.equal(Number(viajeDb.precio_final), 50000)

    // Client confirms closure -> finalized
    const confirmClose = await client.post(`/api/trips/${tripId}/confirm-close`)
      .header('Authorization', `Bearer ${clientToken}`)
      .json({ confirmar: true })
    confirmClose.assertStatus(200)
    assert.equal(confirmClose.body().estado, 'finalizado')
    const viajeFinal = await db.from('viajes').where('id', tripId).first()
    assert.equal(viajeFinal.estado, 'finalizado')
  })
})