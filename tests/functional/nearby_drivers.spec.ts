import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'

const ORIGEN = { lat: 3.4516, lng: -76.532 }

function email(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 100000000)}@test.com`
}

async function registrarCliente(client: any) {
  const res = await client.post('/api/auth/register').json({
    nombre: 'ND', apellido: 'Cliente', email: email('nd-cliente'), password: '123456', rol: 'cliente', edad: 30,
  })
  res.assertStatus(200)
  return { token: res.body().token as string, id: Number(res.body().id) }
}

/** Conductor aprobado y online con ubicación a `km` al norte del origen, de hace `edadSeg` segundos. */
async function conductorEn(client: any, km: number, edadSeg = 0, online = true) {
  const res = await client.post('/api/auth/register').json({
    nombre: 'ND', apellido: 'Conductor', email: email('nd-driver'), password: '123456', rol: 'conductor', edad: 30,
    cedula: `${Date.now()}${Math.floor(Math.random() * 100000)}`.slice(-16),
    placa: `ND${Date.now().toString().slice(-8)}${Math.floor(Math.random() * 1000)}`,
    tipoVehiculo: 'camioneta', capacidad: '1000 kg',
  })
  res.assertStatus(200)
  await db.from('conductores').where('usuario_id', Number(res.body().id)).update({
    estado_verificacion: 'aprobado',
    online,
    ultima_ubicacion_lat: ORIGEN.lat + km / 111,
    ultima_ubicacion_lng: ORIGEN.lng,
    ubicacion_actualizada_en: DateTime.now().minus({ seconds: edadSeg }).toSQL(),
  })
}

async function crearViaje(client: any, token: string) {
  const trip = await client
    .post('/api/trips/request')
    .header('Authorization', `Bearer ${token}`)
    .json({
      origen: { direccion: 'Origen ND', lat: ORIGEN.lat, lng: ORIGEN.lng },
      destino: { direccion: 'Destino ND', lat: 3.3, lng: -76.53 },
      descripcion: 'carga nearby',
      precioCliente: 50000,
    })
  trip.assertStatus(200)
  return Number(trip.body().id)
}

test.group('Conductores visibles mientras se busca conductor', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('devuelve solo conductores online, aprobados, recientes y a <= 2 km', async ({ client, assert }) => {
    const cliente = await registrarCliente(client)
    await conductorEn(client, 0.5) // visible
    await conductorEn(client, 1.8) // visible
    await conductorEn(client, 3) // fuera de radio
    await conductorEn(client, 0.4, 600) // ubicación vieja
    await conductorEn(client, 0.3, 0, false) // offline
    const tripId = await crearViaje(client, cliente.token)

    const res = await client
      .get(`/api/trips/${tripId}/nearby-drivers`)
      .header('Authorization', `Bearer ${cliente.token}`)
    res.assertStatus(200)
    const { radioKm, conductores } = res.body()
    assert.equal(radioKm, 2)
    assert.lengthOf(conductores, 2)
    assert.isTrue(conductores.every((c: any) => c.distanciaKm <= 2 && typeof c.lat === 'number'))
    assert.isTrue(conductores[0].distanciaKm <= conductores[1].distanciaKm)
    assert.notProperty(conductores[0], 'nombre')
    assert.notProperty(conductores[0], 'placa')
  })

  test('otro cliente no puede ver los conductores de un viaje ajeno', async ({ client }) => {
    const dueno = await registrarCliente(client)
    const otro = await registrarCliente(client)
    const tripId = await crearViaje(client, dueno.token)

    const res = await client
      .get(`/api/trips/${tripId}/nearby-drivers`)
      .header('Authorization', `Bearer ${otro.token}`)
    res.assertStatus(403)
  })
})
