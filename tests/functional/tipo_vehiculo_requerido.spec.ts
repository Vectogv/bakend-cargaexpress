import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import ConfiguracionPlataforma from '#models/configuracion_plataforma'
import Conductor from '#models/conductor'
import Viaje from '#models/viaje'

/**
 * Tipo de vehículo requerido (opcional, informativo): no filtra conductores,
 * solo viaja como etiqueta en la respuesta del viaje. Mismo flujo que
 * flujo_ofertas.spec.ts / pin_entrega_receptor_foto_recogida.spec.ts.
 */

const uniq = () => `${Date.now()}${Math.floor(Math.random() * 1e6)}`

const ORIGEN = { direccion: 'Parque Caldas, Popayán', lat: 2.4419, lng: -76.6063 }
const DESTINO = { direccion: 'Terminal, Popayán', lat: 2.4569, lng: -76.5952 }

async function registrarCliente(client: any) {
  const res = await client.post('/api/auth/register').json({
    nombre: 'Cli',
    apellido: 'Veh',
    email: `veh_cli_${uniq()}@test.com`,
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
    apellido: 'Veh',
    email: `veh_con_${uniq()}@test.com`,
    password: 'Password123',
    rol: 'conductor',
    edad: 35,
    cedula: `${uniq()}`.slice(-9),
    placa: `VEH${`${uniq()}`.slice(-3)}`,
    tipoVehiculo: 'camioneta',
    capacidad: '1 tonelada',
    ciudad: 'popayan',
  })
  res.assertStatus(200)
  const conductor = await Conductor.findByOrFail('usuario_id', Number(res.body().id))
  conductor.estadoVerificacion = 'aprobado'
  conductor.ciudad = 'popayan'
  await conductor.save()
  return { token: res.body().token as string, conductorId: conductor.id }
}

async function ubicar(conductorId: number, lat: number, lng: number) {
  const conductor = await Conductor.findOrFail(conductorId)
  conductor.ultimaUbicacionLat = lat
  conductor.ultimaUbicacionLng = lng
  conductor.ubicacionActualizadaEn = DateTime.now()
  await conductor.save()
}

test.group('Tipo de vehículo requerido', (group) => {
  group.each.setup(async () => {
    await ConfiguracionPlataforma.query().delete()
  })

  test('se guarda al pedir el viaje y viaja en la respuesta a cliente y conductor', async ({
    client,
    assert,
  }) => {
    const tokenC = await registrarCliente(client)
    const driver = await registrarConductor(client)
    await ubicar(driver.conductorId, ORIGEN.lat, ORIGEN.lng)

    const creado = await client.post('/api/trips/request').bearerToken(tokenC).json({
      origen: ORIGEN,
      destino: DESTINO,
      descripcion: 'Caja',
      precioCliente: 80000,
      tipoVehiculoRequerido: 'Furgón cerrado',
    })
    creado.assertStatus(200)
    const viajeId = creado.body().id as string
    assert.equal(creado.body().tipoVehiculoRequerido, 'Furgón cerrado')

    const enBd = await Viaje.findOrFail(viajeId)
    assert.equal(enBd.tipoVehiculoRequerido, 'Furgón cerrado')

    const vistaCliente = await client.get(`/api/trips/${viajeId}`).bearerToken(tokenC)
    assert.equal(vistaCliente.body().tipoVehiculoRequerido, 'Furgón cerrado')

    const oferta = await client
      .post(`/api/trips/${viajeId}/offers`)
      .bearerToken(driver.token)
      .json({ monto: 75000 })
    oferta.assertStatus(201)
    const acepta = await client
      .post(`/api/trips/${viajeId}/offers/${oferta.body().id}/accept`)
      .bearerToken(tokenC)
    acepta.assertStatus(200)

    // Es informativo para todos los roles, a diferencia del PIN: el conductor
    // también debe verlo.
    const vistaConductor = await client.get(`/api/trips/${viajeId}`).bearerToken(driver.token)
    assert.equal(vistaConductor.body().tipoVehiculoRequerido, 'Furgón cerrado')
  })

  test('aparece en /api/trips/nearby para que el conductor vea la etiqueta', async ({
    client,
    assert,
  }) => {
    const tokenC = await registrarCliente(client)
    const driver = await registrarConductor(client)
    await ubicar(driver.conductorId, ORIGEN.lat, ORIGEN.lng)

    const creado = await client.post('/api/trips/request').bearerToken(tokenC).json({
      origen: ORIGEN,
      destino: DESTINO,
      descripcion: 'Caja',
      precioCliente: 80000,
      tipoVehiculoRequerido: 'Camioneta',
    })
    creado.assertStatus(200)
    const viajeId = creado.body().id as string

    const cercanos = await client
      .get(`/api/trips/nearby?lat=${ORIGEN.lat}&lng=${ORIGEN.lng}`)
      .bearerToken(driver.token)
    cercanos.assertStatus(200)
    const viaje = (cercanos.body() as any[]).find((v) => String(v.id) === String(viajeId))
    assert.exists(viaje)
    assert.equal(viaje.tipoVehiculoRequerido, 'Camioneta')
  })
})
