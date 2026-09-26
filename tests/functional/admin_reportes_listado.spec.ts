import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import Conductor from '#models/conductor'
import Viaje from '#models/viaje'
import User from '#models/user'

/**
 * Listados de reportes que consume el panel web:
 *   GET /api/admin/reports            (Reportes: cliente ⇄ conductor)
 *   PUT /api/admin/reports/:id/resolve
 *   GET /api/admin/moderator-reports  (Reportes de moderadores)
 *   GET /api/moderator/reports        (Mis reportes, del moderador)
 *
 * Regresión: el preload de `conductor` hacía `select('id', 'placa')` sin
 * `usuario_id`, así que Lucid no podía precargar `usuario` y el listado
 * respondía 500 en cuanto existía un reporte ("Cannot preload "usuario",
 * value of "Conductor.usuarioId" is undefined"). No había ningún test que
 * llamara al listado, por eso se escapó.
 */

const uniq = () => `${Date.now()}${Math.floor(Math.random() * 1e6)}`

async function registrarCliente(client: any) {
  const res = await client.post('/api/auth/register').json({
    nombre: 'Clara',
    apellido: 'Cliente',
    email: `cli_listado_${uniq()}@test.com`,
    password: 'Password123',
    rol: 'cliente',
    edad: 30,
  })
  res.assertStatus(200)
  return { id: Number(res.body().id), token: res.body().token as string }
}

async function registrarConductor(client: any) {
  const placa = `LST${`${uniq()}`.slice(-3)}`
  const res = await client.post('/api/auth/register').json({
    nombre: 'Carlos',
    apellido: 'Conductor',
    email: `con_listado_${uniq()}@test.com`,
    password: 'Password123',
    rol: 'conductor',
    edad: 35,
    cedula: `${uniq()}`.slice(-10),
    placa,
    tipoVehiculo: 'camioneta',
    capacidad: '1 tonelada',
    ciudad: 'popayan',
  })
  res.assertStatus(200)
  const usuarioId = Number(res.body().id)
  const conductor = await Conductor.findByOrFail('usuario_id', usuarioId)
  return { token: res.body().token as string, conductorId: conductor.id, usuarioId, placa }
}

async function tokenAdmin(client: any) {
  const { id } = await registrarCliente(client)
  await User.query().where('id', id).update({ rol: 'admin' })
  const email = (await User.findOrFail(id)).email
  const login = await client.post('/api/auth/login').json({ email, password: 'Password123' })
  login.assertStatus(200)
  return login.body().token as string
}

async function crearModerador(client: any, zona: string) {
  const user = await User.create({
    nombre: 'Mónica',
    apellido: 'Moderadora',
    email: `mod_listado_${uniq()}@test.com`,
    password: 'Password123',
    rol: 'moderador',
    esModerador: true,
    zonaModerador: zona,
  } as any)
  const login = await client
    .post('/api/auth/login')
    .json({ email: user.email, password: 'Password123' })
  login.assertStatus(200)
  return { id: user.id, token: login.body().token as string }
}

async function crearViaje(clienteId: number, conductorId: number) {
  return Viaje.create({
    clienteId,
    conductorId,
    estado: 'finalizado',
    origenDireccion: 'Parque Caldas, Popayán',
    origenLat: 2.4419,
    origenLng: -76.6063,
    destinoDireccion: 'Terminal, Popayán',
    destinoLat: 2.4569,
    destinoLng: -76.5952,
    precioCliente: 50000,
    precioEstimado: 50000,
  } as any)
}

/** Los listados paginados devuelven el arreglo directo o envuelto en `data`. */
function items(body: any): any[] {
  if (Array.isArray(body)) return body
  if (Array.isArray(body?.data)) return body.data
  return []
}

test.group('Admin: listado de reportes', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('GET /api/admin/reports responde 200 con reportes en los dos sentidos', async ({
    client,
    assert,
  }) => {
    const admin = await tokenAdmin(client)
    const cliente = await registrarCliente(client)
    const conductor = await registrarConductor(client)
    const viaje = await crearViaje(cliente.id, conductor.conductorId)

    // cliente → conductor
    const delCliente = await client
      .post(`/api/trips/${viaje.id}/report`)
      .bearerToken(cliente.token)
      .json({ motivo: 'comportamiento', descripcion: 'fue grosero' })
    delCliente.assertStatus(201)

    // conductor → cliente
    const delConductor = await client
      .post(`/api/trips/${viaje.id}/report`)
      .bearerToken(conductor.token)
      .json({ motivo: 'no_pago', descripcion: 'no pagó el flete' })
    delConductor.assertStatus(201)

    const res = await client.get('/api/admin/reports?limit=100').bearerToken(admin)
    res.assertStatus(200)

    const lista = items(res.body())
    const porCliente = lista.find((r) => Number(r.id) === Number(delCliente.body().id))
    const porConductor = lista.find((r) => Number(r.id) === Number(delConductor.body().id))
    assert.exists(porCliente, 'el reporte del cliente debe estar en el listado')
    assert.exists(porConductor, 'el reporte del conductor debe estar en el listado')

    // Forma del elemento que usa ReportsPage.jsx
    for (const r of [porCliente, porConductor]) {
      assert.equal(Number(r.viajeId), Number(viaje.id))
      assert.equal(Number(r.conductorId), conductor.conductorId)
      assert.equal(Number(r.clienteId), cliente.id)
      assert.equal(r.estado, 'pendiente')
      assert.isString(r.createdAt)
      assert.deepEqual(Object.keys(r.cliente).sort(), ['email', 'nombre', 'reputacion', 'visibilidad'])
      assert.equal(r.cliente.nombre, 'Clara Cliente')
      assert.deepEqual(Object.keys(r.conductor).sort(), ['nombre', 'placa'])
      assert.equal(r.conductor.nombre, 'Carlos Conductor')
      assert.equal(r.conductor.placa, conductor.placa)
      assert.deepEqual(r.viaje, {
        origen: 'Parque Caldas, Popayán',
        destino: 'Terminal, Popayán',
        estado: 'finalizado',
      })
    }

    assert.equal(porCliente.reportadoPor, 'cliente')
    assert.equal(porCliente.motivo, 'comportamiento')
    assert.equal(porCliente.descripcion, 'fue grosero')

    assert.equal(porConductor.reportadoPor, 'conductor')
    assert.equal(porConductor.motivo, 'no_pago')
    assert.equal(porConductor.descripcion, 'no pagó el flete')

    // Al reportado se le baja la reputación: el listado lo refleja.
    assert.equal(Number(porConductor.cliente.reputacion), 3)
    assert.equal(porConductor.cliente.visibilidad, 'reducida')
  })

  test('PUT /api/admin/reports/:id/resolve marca el reporte y el listado lo muestra resuelto', async ({
    client,
    assert,
  }) => {
    const admin = await tokenAdmin(client)
    const cliente = await registrarCliente(client)
    const conductor = await registrarConductor(client)
    const viaje = await crearViaje(cliente.id, conductor.conductorId)

    const creado = await client
      .post(`/api/trips/${viaje.id}/report`)
      .bearerToken(cliente.token)
      .json({ motivo: 'otro' })
    creado.assertStatus(201)
    const id = Number(creado.body().id)

    const resuelto = await client.put(`/api/admin/reports/${id}/resolve`).bearerToken(admin)
    resuelto.assertStatus(200)
    assert.equal(Number(resuelto.body().id), id)
    assert.equal(resuelto.body().estado, 'resuelto')

    const lista = await client.get('/api/admin/reports?limit=100').bearerToken(admin)
    lista.assertStatus(200)
    const r = items(lista.body()).find((x) => Number(x.id) === id)
    assert.exists(r)
    assert.equal(r.estado, 'resuelto')
    assert.equal(r.reportadoPor, 'cliente')
    assert.equal(r.conductor.placa, conductor.placa)

    const inexistente = await client.put('/api/admin/reports/999999999/resolve').bearerToken(admin)
    inexistente.assertStatus(404)
  })

  test('el listado de reportes es solo para admin', async ({ client }) => {
    const cliente = await registrarCliente(client)
    const res = await client.get('/api/admin/reports').bearerToken(cliente.token)
    res.assertStatus(403)
  })
})

test.group('Admin y moderador: reportes de moderadores', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('GET /api/admin/moderator-reports y GET /api/moderator/reports responden 200 con el conductor', async ({
    client,
    assert,
  }) => {
    const admin = await tokenAdmin(client)
    const moderador = await crearModerador(client, 'popayan')
    const conductor = await registrarConductor(client)

    const creado = await client
      .post(`/api/moderator/drivers/${conductor.conductorId}/report`)
      .bearerToken(moderador.token)
      .json({ descripcion: 'Conduce sin documentos al día' })
    creado.assertStatus(200)
    const id = Number(creado.body().id)

    // Admin: ModeratorReportsPage.jsx
    const deAdmin = await client.get('/api/admin/moderator-reports?limit=100').bearerToken(admin)
    deAdmin.assertStatus(200)
    const r = items(deAdmin.body()).find((x) => Number(x.id) === id)
    assert.exists(r, 'el reporte del moderador debe estar en el listado del admin')
    assert.equal(Number(r.moderadorId), moderador.id)
    assert.equal(Number(r.conductorId), conductor.conductorId)
    assert.equal(r.descripcion, 'Conduce sin documentos al día')
    assert.equal(r.estado, 'pendiente')
    assert.deepEqual(r.moderador, { nombre: 'Mónica Moderadora' })
    assert.deepEqual(r.conductor, { nombre: 'Carlos Conductor', placa: conductor.placa })
    assert.isString(r.createdAt)

    // Moderador: sus propios reportes
    const propios = await client.get('/api/moderator/reports?limit=100').bearerToken(moderador.token)
    propios.assertStatus(200)
    const mio = items(propios.body()).find((x) => Number(x.id) === id)
    assert.exists(mio)
    assert.equal(Number(mio.conductorId), conductor.conductorId)
    assert.equal(mio.estado, 'pendiente')
  })
})
