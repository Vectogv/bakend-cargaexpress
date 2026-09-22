import { test } from '@japa/runner'
import ConfiguracionPlataforma from '#models/configuracion_plataforma'
import Conductor from '#models/conductor'
import User from '#models/user'

/**
 * Flujo real cliente <-> conductor (el que usa la app móvil):
 * pedir → ofertar → aceptar → llegada → recogida → iniciar → completar →
 * confirmar cierre → calificar.
 */

const uniq = () => `${Date.now()}${Math.floor(Math.random() * 1e6)}`

const ORIGEN = { direccion: 'Parque Caldas, Popayán', lat: 2.4419, lng: -76.6063 }
const DESTINO = { direccion: 'Terminal, Popayán', lat: 2.4569, lng: -76.5952 }

async function registrarCliente(client: any) {
  const res = await client.post('/api/auth/register').json({
    nombre: 'Cli',
    apellido: 'Test',
    email: `flujo_cli_${uniq()}@test.com`,
    password: 'Password123',
    rol: 'cliente',
    edad: 30,
    telefono: '3105550001',
  })
  res.assertStatus(200)
  return (res.body() as { token: string; id: string }).token
}

async function registrarConductor(client: any, { aprobado = true } = {}) {
  const res = await client.post('/api/auth/register').json({
    nombre: 'Con',
    apellido: 'Test',
    email: `flujo_con_${uniq()}@test.com`,
    password: 'Password123',
    rol: 'conductor',
    edad: 35,
    cedula: `${uniq()}`.slice(-9),
    placa: `ABC${`${uniq()}`.slice(-3)}`,
    tipoVehiculo: 'camioneta',
    capacidad: '1 tonelada',
    ciudad: 'popayan',
  })
  res.assertStatus(200)
  const body = res.body() as { token: string; id: string }
  const conductor = await Conductor.findByOrFail('usuario_id', Number(body.id))
  conductor.estadoVerificacion = aprobado ? 'aprobado' : 'pendiente'
  conductor.ciudad = 'popayan'
  await conductor.save()
  return { token: body.token, conductorId: conductor.id, usuarioId: Number(body.id) }
}

const pedirViaje = (client: any, token: string) =>
  client.post('/api/trips/request').bearerToken(token).json({
    origen: ORIGEN,
    destino: DESTINO,
    descripcion: 'Trasteo pequeño',
    precioCliente: 80000,
  })

/** La ubicación se escribe directo: el endpoint tiene límite de frecuencia. */
async function ubicar(conductorId: number, lat: number, lng: number) {
  const conductor = await Conductor.findOrFail(conductorId)
  conductor.ultimaUbicacionLat = lat
  conductor.ultimaUbicacionLng = lng
  conductor.ubicacionActualizadaEn = (await import('luxon')).DateTime.now()
  await conductor.save()
}

test.group('Flujo de viaje con ofertas', (group) => {
  group.each.setup(async () => {
    await ConfiguracionPlataforma.query().delete()
  })

  test('recorrido completo hasta finalizar y calificar', async ({ client, assert }) => {
    const tokenC = await registrarCliente(client)
    const driver = await registrarConductor(client)
    await ubicar(driver.conductorId, ORIGEN.lat, ORIGEN.lng)
    await client.put('/api/drivers/status').bearerToken(driver.token).json({ online: true })

    const viaje = await pedirViaje(client, tokenC)
    viaje.assertStatus(200)
    const viajeId = (viaje.body() as { id: string; estado: string }).id
    assert.equal((viaje.body() as any).estado, 'buscando_conductor')

    // El conductor ve el viaje cercano, pero no el teléfono del cliente.
    const cercanos = await client.get(`/api/trips/nearby?lat=${ORIGEN.lat}&lng=${ORIGEN.lng}`).bearerToken(driver.token)
    cercanos.assertStatus(200)
    assert.isTrue((cercanos.body() as any[]).some((v) => String(v.id) === String(viajeId)))

    const vistaPrevia = await client.get(`/api/trips/${viajeId}`).bearerToken(driver.token)
    vistaPrevia.assertStatus(200)
    assert.isNull((vistaPrevia.body() as any).cliente.telefono)

    // Oferta y aceptación.
    const oferta = await client
      .post(`/api/trips/${viajeId}/offers`)
      .bearerToken(driver.token)
      .json({ monto: 75000, placa: 'ABC123', mensaje: 'Voy en 10 minutos' })
    oferta.assertStatus(201)
    const ofertaId = (oferta.body() as { id: string }).id

    const lista = await client.get(`/api/trips/${viajeId}/offers`).bearerToken(tokenC)
    lista.assertStatus(200)
    assert.equal((lista.body() as any[])[0].conductor.nombre, 'Con Test')

    const acepta = await client.post(`/api/trips/${viajeId}/offers/${ofertaId}/accept`).bearerToken(tokenC)
    acepta.assertStatus(200)
    assert.equal((acepta.body() as any).estado, 'aceptado')

    // Ya asignado, el conductor sí ve el teléfono para coordinar.
    const conAsignacion = await client.get(`/api/trips/${viajeId}`).bearerToken(driver.token)
    assert.equal((conAsignacion.body() as any).cliente.telefono, '3105550001')

    // Llegada → recogida → en curso.
    for (const [ruta, estado] of [
      ['confirm-arrival', 'conductor_en_camino'],
      ['confirm-pickup', 'conductor_llegada'],
      ['start-trip', 'en_curso'],
    ] as const) {
      const res = await client.post(`/api/trips/${viajeId}/${ruta}`).bearerToken(driver.token)
      res.assertStatus(200)
      assert.equal((res.body() as any).estado, estado)
    }

    // Cierre: el cliente no puede cerrar por el conductor.
    const intentoCliente = await client.post(`/api/trips/${viajeId}/complete`).bearerToken(tokenC).json({ montoFinal: 75000 })
    assert.isAbove(intentoCliente.status(), 399)

    await ubicar(driver.conductorId, DESTINO.lat, DESTINO.lng)
    const completa = await client.post(`/api/trips/${viajeId}/complete`).bearerToken(driver.token).json({ montoFinal: 75000 })
    completa.assertStatus(200)
    assert.equal((completa.body() as any).estado, 'pendiente_confirmacion')

    const cierre = await client.post(`/api/trips/${viajeId}/confirm-close`).bearerToken(tokenC).json({ confirmar: true })
    cierre.assertStatus(200)
    assert.equal((cierre.body() as any).estado, 'finalizado')

    const califica = await client.post(`/api/trips/${viajeId}/rate`).bearerToken(tokenC).json({ puntaje: 5, comentario: 'Todo bien' })
    califica.assertStatus(200)

    const ganancias = await client.get('/api/drivers/earnings').bearerToken(driver.token)
    ganancias.assertStatus(200)
    assert.equal((ganancias.body() as any).hoy.viajesCompletados, 1)
    assert.equal((ganancias.body() as any).hoy.montoBruto, 75000)
  })

  test('cerrar lejos del destino exige justificación', async ({ client, assert }) => {
    const tokenC = await registrarCliente(client)
    const driver = await registrarConductor(client)
    await ubicar(driver.conductorId, ORIGEN.lat, ORIGEN.lng)

    const viaje = await pedirViaje(client, tokenC)
    const viajeId = (viaje.body() as { id: string }).id
    const oferta = await client.post(`/api/trips/${viajeId}/offers`).bearerToken(driver.token).json({ monto: 70000 })
    const ofertaId = (oferta.body() as { id: string }).id
    await client.post(`/api/trips/${viajeId}/offers/${ofertaId}/accept`).bearerToken(tokenC)
    await client.post(`/api/trips/${viajeId}/confirm-arrival`).bearerToken(driver.token)
    await client.post(`/api/trips/${viajeId}/confirm-pickup`).bearerToken(driver.token)
    await client.post(`/api/trips/${viajeId}/start-trip`).bearerToken(driver.token)

    // Sigue en el origen: lejos del destino.
    const sinJustificar = await client.post(`/api/trips/${viajeId}/complete`).bearerToken(driver.token).json({ montoFinal: 70000 })
    sinJustificar.assertStatus(422)
    assert.equal((sinJustificar.body() as any).code, 'JUSTIFICACION_REQUERIDA')

    const conJustificacion = await client
      .post(`/api/trips/${viajeId}/complete`)
      .bearerToken(driver.token)
      .json({ montoFinal: 70000, justificacion: 'El cliente pidió descargar antes del destino' })
    conJustificacion.assertStatus(200)
  })

  test('un conductor sin verificar no puede ofertar', async ({ client }) => {
    const tokenC = await registrarCliente(client)
    const driver = await registrarConductor(client, { aprobado: false })
    await ubicar(driver.conductorId, ORIGEN.lat, ORIGEN.lng)

    const viaje = await pedirViaje(client, tokenC)
    const viajeId = (viaje.body() as { id: string }).id

    const oferta = await client.post(`/api/trips/${viajeId}/offers`).bearerToken(driver.token).json({ monto: 50000 })
    oferta.assertStatus(403)
    oferta.assertBodyContains({ error: 'Tu cuenta de conductor no está verificada.' })
  })

  test('un conductor suspendido pierde el acceso al viaje', async ({ client }) => {
    const tokenC = await registrarCliente(client)
    const driver = await registrarConductor(client)
    await ubicar(driver.conductorId, ORIGEN.lat, ORIGEN.lng)

    const viaje = await pedirViaje(client, tokenC)
    const viajeId = (viaje.body() as { id: string }).id
    await User.query().where('id', driver.usuarioId).update({ suspendido: true })

    const oferta = await client.post(`/api/trips/${viajeId}/offers`).bearerToken(driver.token).json({ monto: 50000 })
    oferta.assertStatus(403)
    oferta.assertBodyContains({ code: 'CUENTA_SUSPENDIDA' })
  })
})
