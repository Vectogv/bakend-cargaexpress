import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'
import ConfiguracionPlataforma from '#models/configuracion_plataforma'
import Conductor from '#models/conductor'
import Oferta from '#models/oferta'
import Viaje from '#models/viaje'
import User from '#models/user'
import BusquedaEscaleraService, { ESCALERA_DEFAULT } from '#services/busqueda_escalera_service'
import { distanciaKm } from '#services/geo_service'
import BusquedaTimeoutService from '#services/busqueda_timeout_service'

/**
 * Escalera de acompañamiento para viajes sin ofertas: publicado → ampliada →
 * sugerencia → cierre, con "subir precio" y "seguir esperando" del cliente.
 */

const uniq = () => `${Date.now()}${Math.floor(Math.random() * 1e6)}`
const sql = (d: DateTime) => d.toFormat('yyyy-MM-dd HH:mm:ss')
const ahoraMas = (minutos: number) => DateTime.now().plus({ minutes: minutos })

async function registrar(client: any, rol: 'cliente' | 'conductor' | 'admin') {
  if (rol === 'admin') {
    const email = `escalera_admin_${uniq()}@test.com`
    await User.create({ nombre: 'Admin', apellido: 'Escalera', email, password: 'Password123', rol: 'admin' })
    const login = await client.post('/api/auth/login').json({ email, password: 'Password123' })
    login.assertStatus(200)
    return { token: (login.body() as { token: string }).token, id: 0 }
  }
  const extra =
    rol === 'conductor'
      ? {
          cedula: `${uniq()}`.slice(-9),
          placa: `ESC${`${uniq()}`.slice(-3)}`,
          tipoVehiculo: 'camioneta',
          capacidad: '1 tonelada',
          ciudad: 'popayan',
        }
      : {}
  const res = await client.post('/api/auth/register').json({
    nombre: rol,
    apellido: 'Escalera',
    email: `escalera_${rol}_${uniq()}@test.com`,
    password: 'Password123',
    rol,
    edad: 30,
    ...extra,
  })
  res.assertStatus(200)
  const body = res.body() as { token: string; id: string }
  return { token: body.token, id: Number(body.id) }
}

const ORIGEN = { direccion: 'Parque Caldas', lat: 2.4419, lng: -76.6063 }
const DESTINO = { direccion: 'Terminal', lat: 2.4569, lng: -76.5952 }

async function pedirViaje(client: any, token: string, precio = 50000, tipoVehiculoRequerido?: string) {
  const pedido = await client
    .post('/api/trips/request')
    .bearerToken(token)
    .json({ origen: ORIGEN, destino: DESTINO, descripcion: 'Caja', precioCliente: precio, tipoVehiculoRequerido })
  pedido.assertStatus(200)
  return { id: Number((pedido.body() as { id: string }).id), body: pedido.body() }
}

/** Simula que la búsqueda empezó hace N minutos (sin tocar busqueda_hasta). */
async function envejecer(viajeId: number, minutos: number) {
  await db.from('viajes').where('id', viajeId).update({ created_at: sql(DateTime.now().minus({ minutes: minutos })) })
}

async function etapaDe(viajeId: number) {
  const v = await Viaje.findOrFail(viajeId)
  return v.busquedaEtapa
}

test.group('Escalera de acompañamiento', (group) => {
  group.each.setup(async () => {
    await ConfiguracionPlataforma.query().delete()
  })
  // Los viajes con `busqueda_hasta` futuro ya no los barre BusquedaTimeoutService:
  // se cierran aquí para no llenar el /nearby (límite 20) de otras pruebas.
  group.each.teardown(async () => {
    await db.from('viajes').whereIn('estado', ['buscando_conductor', 'pendiente']).update({ estado: 'cancelado' })
  })

  test('al publicar queda en etapa publicado con mensaje y corte de cancelación', async ({ client, assert }) => {
    const cliente = await registrar(client, 'cliente')
    const { id, body } = await pedirViaje(client, cliente.token)
    assert.equal(body.busqueda.etapa, 'publicado')
    assert.include(body.busqueda.mensaje, 'publicada')
    assert.isNull(body.busqueda.precioSugerido)
    assert.isNull(body.busqueda.cierreHasta)

    const viaje = await Viaje.findOrFail(id)
    const esperado = ESCALERA_DEFAULT.minCierre + ESCALERA_DEFAULT.minRespuestaCierre
    const minutos = viaje.busquedaHasta!.diff(viaje.createdAt, 'minutes').minutes
    assert.closeTo(minutos, esperado, 1)

    const activo = await client.get('/api/trips/active').bearerToken(cliente.token)
    activo.assertStatus(200)
    assert.equal(activo.body().busqueda.etapa, 'publicado')
  })

  test('sube un peldaño por barrido y no repite etapas', async ({ client, assert }) => {
    const cliente = await registrar(client, 'cliente')
    const { id } = await pedirViaje(client, cliente.token)

    // Aún no es hora de nada.
    await BusquedaEscaleraService.avanzar()
    assert.equal(await etapaDe(id), 'publicado')

    await envejecer(id, 4)
    let cambios = await BusquedaEscaleraService.avanzar()
    assert.deepInclude(cambios, { id, etapa: 'ampliada' })
    cambios = await BusquedaEscaleraService.avanzar()
    assert.notInclude(cambios.map((c) => c.id), id)
    assert.equal(await etapaDe(id), 'ampliada')

    await envejecer(id, 6)
    cambios = await BusquedaEscaleraService.avanzar()
    // Con las tarifas en 0 (por defecto) no hay sugerencia: sigue en ampliada.
    assert.equal(await etapaDe(id), 'ampliada')

    // Cierre: minRespuestaCierre antes de busqueda_hasta.
    await db.from('viajes').where('id', id).update({ busqueda_hasta: sql(ahoraMas(9)) })
    cambios = await BusquedaEscaleraService.avanzar()
    assert.deepInclude(cambios, { id, etapa: 'cierre' })
    const cerrado = await Viaje.findOrFail(id)
    assert.closeTo(cerrado.busquedaHasta!.diff(DateTime.now(), 'minutes').minutes, 10, 1)
    const act2 = await client.get('/api/trips/active').bearerToken(cliente.token)
    assert.isNotNull(act2.body().busqueda.cierreHasta)
    assert.include(act2.body().busqueda.mensaje, 'prefieres')

    // Ya en cierre no vuelve a cambiar.
    cambios = await BusquedaEscaleraService.avanzar()
    assert.notInclude(cambios.map((c) => c.id), id)
  })

  test('no sube de etapa si hay una oferta viva', async ({ client, assert }) => {
    const cliente = await registrar(client, 'cliente')
    const conductorUser = await registrar(client, 'conductor')
    const conductor = await Conductor.findByOrFail('usuario_id', conductorUser.id)
    const { id } = await pedirViaje(client, cliente.token)
    await envejecer(id, 6)
    const oferta = await Oferta.create({
      viajeId: id,
      conductorId: conductor.id,
      monto: 60000,
      estado: 'pendiente',
      expiraAt: ahoraMas(5),
    })

    await BusquedaEscaleraService.avanzar()
    assert.equal(await etapaDe(id), 'publicado')

    // Oferta vencida: ya no frena la escalera.
    oferta.expiraAt = DateTime.now().minus({ minutes: 1 })
    await oferta.save()
    await BusquedaEscaleraService.avanzar()
    assert.equal(await etapaDe(id), 'ampliada')
  })

  test('el precio sugerido es km por tarifa del tipo, redondeado hacia arriba', async ({ client, assert }) => {
    const cliente = await registrar(client, 'cliente')
    const cfg = { ...ESCALERA_DEFAULT, tarifaKm: { piaggio: 2000, furgon: 4000, camioneta: 3000 } }
    const { id } = await pedirViaje(client, cliente.token, 1000)
    const viaje = await Viaje.findOrFail(id)
    const rango = (tipo: string | null) => {
      viaje.tipoVehiculoRequerido = tipo
      return BusquedaEscaleraService.rangoSugerido(viaje, cfg)
    }
    const km = Math.round(distanciaKm(ORIGEN.lat, ORIGEN.lng, DESTINO.lat, DESTINO.lng) * 10) / 10
    const techo = (tarifa: number) => Math.ceil(Math.round(km * tarifa * 100) / 100 / 1000) * 1000
    assert.deepEqual(await rango('Furgón sellado'), { min: techo(4000), max: techo(4000) })
    assert.deepEqual(await rango('Camioneta'), { min: techo(3000), max: techo(3000) })
    assert.deepEqual(await rango('Mini camión (Piaggio)'), { min: techo(2000), max: techo(2000) })
    // Desconocido o sin tipo → la tarifa más baja mayor que 0 (piaggio).
    assert.deepEqual(await rango('Moto'), { min: techo(2000), max: techo(2000) })
    assert.deepEqual(await rango(null), { min: techo(2000), max: techo(2000) })
  })

  test('tarifa 0 para el tipo, o precio que no la supera → sin sugerencia', async ({ client, assert }) => {
    const cliente = await registrar(client, 'cliente')
    const { id } = await pedirViaje(client, cliente.token, 50000, 'Furgón sellado')
    const viaje = await Viaje.findOrFail(id)
    // Tarifas en 0 (por defecto).
    assert.isNull(await BusquedaEscaleraService.rangoSugerido(viaje, ESCALERA_DEFAULT))
    // Tarifa tan baja que el sugerido no supera los $50.000 del cliente.
    const baja = { ...ESCALERA_DEFAULT, tarifaKm: { piaggio: 1, furgon: 1, camioneta: 1 } }
    assert.isNull(await BusquedaEscaleraService.rangoSugerido(viaje, baja))
    // Furgón en 0 con camioneta con tarifa: el furgón no cae a otra tarifa.
    const soloCamioneta = { ...ESCALERA_DEFAULT, tarifaKm: { piaggio: 0, furgon: 0, camioneta: 90000 } }
    assert.isNull(await BusquedaEscaleraService.rangoSugerido(viaje, soloCamioneta))
  })

  test('la etapa sugerencia guarda el precio y arma el mensaje con km', async ({ client, assert }) => {
    const admin = await registrar(client, 'admin')
    const cliente = await registrar(client, 'cliente')
    const put = await client
      .put('/api/admin/config')
      .bearerToken(admin.token)
      .json({ escalera: { tarifaKm: { piaggio: 50000, furgon: 50000, camioneta: 50000 } } })
    put.assertStatus(200)
    const { id } = await pedirViaje(client, cliente.token, 20000)
    await envejecer(id, 6)
    await BusquedaEscaleraService.avanzar() // ampliada
    const cambios = await BusquedaEscaleraService.avanzar()
    assert.deepInclude(cambios, { id, etapa: 'sugerencia' })
    const v = await Viaje.findOrFail(id)
    assert.equal(v.precioSugeridoMin, v.precioSugeridoMax)
    const activo = await client.get('/api/trips/active').bearerToken(cliente.token)
    const ps = activo.body().busqueda.precioSugerido
    assert.equal(ps.min, ps.max)
    assert.isAbove(ps.km, 0)
    assert.equal(
      activo.body().busqueda.mensaje,
      `Para ${ps.km.toLocaleString('es-CO')} km, el valor sugerido es $${ps.min.toLocaleString('es-CO')}`
    )
  })

  test('PUT /precio sube el precio y rechaza uno menor o igual', async ({ client, assert }) => {
    const cliente = await registrar(client, 'cliente')
    const { id } = await pedirViaje(client, cliente.token)

    const menor = await client.put(`/api/trips/${id}/precio`).bearerToken(cliente.token).json({ precio: 50000 })
    menor.assertStatus(422)
    const exagerado = await client.put(`/api/trips/${id}/precio`).bearerToken(cliente.token).json({ precio: 200000 })
    exagerado.assertStatus(422)

    const ok = await client.put(`/api/trips/${id}/precio`).bearerToken(cliente.token).json({ precio: 60000 })
    ok.assertStatus(200)
    assert.equal(ok.body().precioEstimado, 60000)
    assert.equal(ok.body().busqueda.etapa, 'publicado')
    const viaje = await Viaje.findOrFail(id)
    assert.equal(Number(viaje.precioCliente), 60000)
    assert.equal(Number(viaje.precioEstimado), 60000)
  })

  test('PUT /precio da 403 si no es el dueño y 409 si ya no busca', async ({ client }) => {
    const cliente = await registrar(client, 'cliente')
    const otro = await registrar(client, 'cliente')
    const { id } = await pedirViaje(client, cliente.token)

    const ajeno = await client.put(`/api/trips/${id}/precio`).bearerToken(otro.token).json({ precio: 60000 })
    ajeno.assertStatus(403)

    await db.from('viajes').where('id', id).update({ estado: 'cancelado' })
    const cerrado = await client.put(`/api/trips/${id}/precio`).bearerToken(cliente.token).json({ precio: 60000 })
    cerrado.assertStatus(409)
  })

  test('seguir esperando solo en cierre: vuelve a ampliada y corre el corte', async ({ client, assert }) => {
    const cliente = await registrar(client, 'cliente')
    const { id } = await pedirViaje(client, cliente.token)

    const antes = await client.post(`/api/trips/${id}/seguir-esperando`).bearerToken(cliente.token)
    antes.assertStatus(409)

    await db.from('viajes').where('id', id).update({ busqueda_etapa: 'cierre', busqueda_hasta: sql(ahoraMas(5)) })
    const ok = await client.post(`/api/trips/${id}/seguir-esperando`).bearerToken(cliente.token)
    ok.assertStatus(200)
    assert.equal(ok.body().busqueda.etapa, 'ampliada')
    const viaje = await Viaje.findOrFail(id)
    assert.closeTo(viaje.busquedaHasta!.diff(DateTime.now(), 'minutes').minutes, ESCALERA_DEFAULT.minSeguirEsperando, 1)

    // Otra vez da 409: ya no está en cierre.
    const repetido = await client.post(`/api/trips/${id}/seguir-esperando`).bearerToken(cliente.token)
    repetido.assertStatus(409)
  })

  test('la cancelación automática respeta busqueda_hasta', async ({ client, assert }) => {
    const cliente = await registrar(client, 'cliente')
    const { id } = await pedirViaje(client, cliente.token)
    // Viejo según la regla de 15 min, pero busqueda_hasta sigue en el futuro.
    await envejecer(id, 25)
    assert.notInclude(await BusquedaTimeoutService.expirarBusquedasVencidas(), id)
    assert.equal((await Viaje.findOrFail(id)).estado, 'buscando_conductor')

    await db.from('viajes').where('id', id).update({ busqueda_hasta: sql(DateTime.now().minus({ minutes: 1 })) })
    assert.include(await BusquedaTimeoutService.expirarBusquedasVencidas(), id)
    assert.equal((await Viaje.findOrFail(id)).estado, 'cancelado')
  })

  test('la escalera se configura desde el panel y respeta los rangos', async ({ client, assert }) => {
    const admin = await registrar(client, 'admin')

    const porDefecto = await client.get('/api/admin/config').bearerToken(admin.token)
    porDefecto.assertStatus(200)
    assert.deepEqual(porDefecto.body().escalera, ESCALERA_DEFAULT)

    const tarifaMala = await client.put('/api/admin/config').bearerToken(admin.token).json({ escalera: { tarifaKm: { furgon: -1 } } })
    tarifaMala.assertStatus(422)
    const tarifaAlta = await client.put('/api/admin/config').bearerToken(admin.token).json({ escalera: { tarifaKm: { camioneta: 100001 } } })
    tarifaAlta.assertStatus(422)
    const viejos = await client.put('/api/admin/config').bearerToken(admin.token).json({ escalera: { pctSugerenciaMin: 15, pctSugerenciaMax: 30 } })
    viejos.assertStatus(200)
    const tarifaOk = await client.put('/api/admin/config').bearerToken(admin.token).json({ escalera: { tarifaKm: { furgon: 4500 } } })
    tarifaOk.assertStatus(200)
    assert.deepEqual(tarifaOk.body().escalera.tarifaKm, { piaggio: 0, furgon: 4500, camioneta: 0 })

    const malo = await client.put('/api/admin/config').bearerToken(admin.token).json({ escalera: { radioAmpliadoKm: 50 } })
    malo.assertStatus(422)
    const desorden = await client.put('/api/admin/config').bearerToken(admin.token).json({ escalera: { minAmpliar: 10 } })
    desorden.assertStatus(422)

    const ok = await client
      .put('/api/admin/config')
      .bearerToken(admin.token)
      .json({ escalera: { minAmpliar: 1, minSugerencia: 2, minCierre: 3, minRespuestaCierre: 2, minSeguirEsperando: 5, etapas: { sugerencia: false } } })
    ok.assertStatus(200)
    assert.equal(ok.body().escalera.minCierre, 3)
    assert.isFalse(ok.body().escalera.etapas.sugerencia)
    assert.isTrue(ok.body().escalera.etapas.ampliar)
    assert.equal(ok.body().escalera.radioInicialKm, 3)

    // La config guardada manda en los viajes nuevos.
    const cliente = await registrar(client, 'cliente')
    const { id } = await pedirViaje(client, cliente.token)
    const viaje = await Viaje.findOrFail(id)
    assert.closeTo(viaje.busquedaHasta!.diff(viaje.createdAt, 'minutes').minutes, 5, 1)
  })
})
