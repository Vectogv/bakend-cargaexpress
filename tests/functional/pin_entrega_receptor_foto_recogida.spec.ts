import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import ConfiguracionPlataforma from '#models/configuracion_plataforma'
import Conductor from '#models/conductor'
import User from '#models/user'
import Viaje from '#models/viaje'
import { TOPE_DEUDA_CONDUCTOR } from '#services/driver_debt_suspension_service'

/**
 * PIN de entrega, contacto de quien recibe, foto al recoger y tope de deuda
 * del conductor. Mismo flujo que flujo_ofertas.spec.ts.
 */

const uniq = () => `${Date.now()}${Math.floor(Math.random() * 1e6)}`

const ORIGEN = { direccion: 'Parque Caldas, Popayán', lat: 2.4419, lng: -76.6063 }
const DESTINO = { direccion: 'Terminal, Popayán', lat: 2.4569, lng: -76.5952 }
const RECEPTOR = { receptorNombre: 'Doña Rosa', receptorTelefono: '3001234567' }

// PNG 1x1 válido.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64'
)

async function registrarCliente(client: any) {
  const res = await client.post('/api/auth/register').json({
    nombre: 'Cli',
    apellido: 'Pin',
    email: `pin_cli_${uniq()}@test.com`,
    password: 'Password123',
    rol: 'cliente',
    edad: 30,
    telefono: '3105550001',
  })
  res.assertStatus(200)
  return res.body().token as string
}

async function registrarConductor(client: any) {
  const res = await client.post('/api/auth/register').json({
    nombre: 'Con',
    apellido: 'Pin',
    email: `pin_con_${uniq()}@test.com`,
    password: 'Password123',
    rol: 'conductor',
    edad: 35,
    cedula: `${uniq()}`.slice(-9),
    placa: `PIN${`${uniq()}`.slice(-3)}`,
    tipoVehiculo: 'camioneta',
    capacidad: '1 tonelada',
    ciudad: 'popayan',
  })
  res.assertStatus(200)
  const conductor = await Conductor.findByOrFail('usuario_id', Number(res.body().id))
  conductor.estadoVerificacion = 'aprobado'
  conductor.ciudad = 'popayan'
  await conductor.save()
  return { token: res.body().token as string, conductorId: conductor.id, usuarioId: Number(res.body().id) }
}

async function ubicar(conductorId: number, lat: number, lng: number) {
  const conductor = await Conductor.findOrFail(conductorId)
  conductor.ultimaUbicacionLat = lat
  conductor.ultimaUbicacionLng = lng
  conductor.ubicacionActualizadaEn = DateTime.now()
  await conductor.save()
}

/** Pide, oferta y acepta. Devuelve el viaje en 'aceptado' y el PIN que vio el cliente. */
async function viajeAceptado(client: any, tokenC: string, driver: { token: string; conductorId: number }) {
  await ubicar(driver.conductorId, ORIGEN.lat, ORIGEN.lng)
  const viaje = await client
    .post('/api/trips/request')
    .bearerToken(tokenC)
    .json({ origen: ORIGEN, destino: DESTINO, descripcion: 'Caja', precioCliente: 80000, ...RECEPTOR })
  viaje.assertStatus(200)
  const viajeId = viaje.body().id as string
  const oferta = await client.post(`/api/trips/${viajeId}/offers`).bearerToken(driver.token).json({ monto: 75000 })
  oferta.assertStatus(201)
  const acepta = await client.post(`/api/trips/${viajeId}/offers/${oferta.body().id}/accept`).bearerToken(tokenC)
  acepta.assertStatus(200)
  return { viajeId, pin: acepta.body().pinEntrega as string }
}

async function llevarEnCurso(client: any, viajeId: string, driver: { token: string; conductorId: number }) {
  for (const ruta of ['confirm-arrival', 'confirm-pickup', 'start-trip']) {
    ;(await client.post(`/api/trips/${viajeId}/${ruta}`).bearerToken(driver.token)).assertStatus(200)
  }
  await ubicar(driver.conductorId, DESTINO.lat, DESTINO.lng)
}

test.group('PIN de entrega, receptor, foto de recogida y tope de deuda', (group) => {
  group.each.setup(async () => {
    await ConfiguracionPlataforma.query().delete()
  })

  test('el receptor viaja en la respuesta y el PIN solo lo ve el cliente', async ({ client, assert }) => {
    const tokenC = await registrarCliente(client)
    const driver = await registrarConductor(client)
    const { viajeId, pin } = await viajeAceptado(client, tokenC, driver)
    assert.match(pin, /^\d{4}$/)

    const vistaCliente = await client.get(`/api/trips/${viajeId}`).bearerToken(tokenC)
    assert.equal(vistaCliente.body().receptorNombre, RECEPTOR.receptorNombre)
    assert.equal(vistaCliente.body().receptorTelefono, RECEPTOR.receptorTelefono)
    assert.equal(vistaCliente.body().pinEntrega, pin)

    const vistaConductor = await client.get(`/api/trips/${viajeId}`).bearerToken(driver.token)
    assert.equal(vistaConductor.body().receptorNombre, RECEPTOR.receptorNombre)
    assert.isNull(vistaConductor.body().pinEntrega)
  })

  test('cerca del destino: sin PIN o con PIN malo no cierra, con el correcto sí', async ({ client, assert }) => {
    const tokenC = await registrarCliente(client)
    const driver = await registrarConductor(client)
    const { viajeId, pin } = await viajeAceptado(client, tokenC, driver)
    await llevarEnCurso(client, viajeId, driver)

    const sinPin = await client.post(`/api/trips/${viajeId}/complete`).bearerToken(driver.token).json({})
    sinPin.assertStatus(422)
    assert.equal(sinPin.body().code, 'PIN_REQUERIDO')

    const malo = pin === '0000' ? '0001' : '0000'
    const pinMalo = await client.post(`/api/trips/${viajeId}/complete`).bearerToken(driver.token).json({ pin: malo })
    pinMalo.assertStatus(422)
    assert.equal(pinMalo.body().code, 'PIN_INCORRECTO')
    assert.equal((await Viaje.findOrFail(viajeId)).estado, 'en_curso')

    const bien = await client.post(`/api/trips/${viajeId}/complete`).bearerToken(driver.token).json({ pin })
    bien.assertStatus(200)
    assert.equal(bien.body().estado, 'pendiente_confirmacion')
  })

  test('lejos del destino no pide PIN: basta la justificación', async ({ client, assert }) => {
    const tokenC = await registrarCliente(client)
    const driver = await registrarConductor(client)
    const { viajeId } = await viajeAceptado(client, tokenC, driver)
    for (const ruta of ['confirm-arrival', 'confirm-pickup', 'start-trip']) {
      ;(await client.post(`/api/trips/${viajeId}/${ruta}`).bearerToken(driver.token)).assertStatus(200)
    }
    // Sigue en el origen.
    const res = await client
      .post(`/api/trips/${viajeId}/complete`)
      .bearerToken(driver.token)
      .json({ justificacion: 'El cliente pidió descargar antes del destino' })
    res.assertStatus(200)
    assert.equal(res.body().estado, 'pendiente_confirmacion')
  })

  test('la foto de recogida sube en conductor_llegada y queda en fotoRecogida', async ({ client, assert }) => {
    const tokenC = await registrarCliente(client)
    const driver = await registrarConductor(client)
    const { viajeId } = await viajeAceptado(client, tokenC, driver)

    // En 'aceptado' todavía no.
    const temprano = await client
      .post(`/api/trips/${viajeId}/pickup-photo`)
      .bearerToken(driver.token)
      .file('file', PNG, { filename: 'carga.png', contentType: 'image/png' })
    temprano.assertStatus(422)

    ;(await client.post(`/api/trips/${viajeId}/confirm-arrival`).bearerToken(driver.token)).assertStatus(200)
    ;(await client.post(`/api/trips/${viajeId}/confirm-pickup`).bearerToken(driver.token)).assertStatus(200)

    const subida = await client
      .post(`/api/trips/${viajeId}/pickup-photo`)
      .bearerToken(driver.token)
      .file('file', PNG, { filename: 'carga.png', contentType: 'image/png' })
    subida.assertStatus(200)
    assert.match(subida.body().fotoRecogida, new RegExp(`^/storage/uploads/pickup-${viajeId}-[0-9a-f-]+\\.png$`))
    assert.equal((await Viaje.findOrFail(viajeId)).fotoRecogida, subida.body().fotoRecogida)

    const vista = await client.get(`/api/trips/${viajeId}`).bearerToken(tokenC)
    assert.equal(vista.body().fotoRecogida, subida.body().fotoRecogida)
  })

  test('un conductor activo oferta bajo el tope de deuda y no por encima', async ({ client, assert }) => {
    const tokenC = await registrarCliente(client)
    const driver = await registrarConductor(client)
    await ubicar(driver.conductorId, ORIGEN.lat, ORIGEN.lng)
    const viaje = await client
      .post('/api/trips/request')
      .bearerToken(tokenC)
      .json({ origen: ORIGEN, destino: DESTINO, precioCliente: 80000 })
    const viajeId = viaje.body().id as string

    await User.query().where('id', driver.usuarioId).update({ monto_deuda: TOPE_DEUDA_CONDUCTOR, tiene_deuda_activa: true })
    const enElTope = await client.post(`/api/trips/${viajeId}/offers`).bearerToken(driver.token).json({ monto: 70000 })
    enElTope.assertStatus(201)

    await User.query().where('id', driver.usuarioId).update({ monto_deuda: TOPE_DEUDA_CONDUCTOR + 1 })
    const pasado = await client.post(`/api/trips/${viajeId}/offers`).bearerToken(driver.token).json({ monto: 69000 })
    pasado.assertStatus(403)
    assert.equal(pasado.body().code, 'DEUDA_SUPERA_TOPE')
    assert.equal(Number(pasado.body().tope), TOPE_DEUDA_CONDUCTOR)

    const online = await client.put('/api/drivers/status').bearerToken(driver.token).json({ online: true })
    online.assertStatus(403)
    assert.equal(online.body().code, 'DEUDA_SUPERA_TOPE')
  })
})
