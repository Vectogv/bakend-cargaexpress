import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import testUtils from '@adonisjs/core/services/test_utils'
import AlertaEmergencia from '#models/alerta_emergencia'
import Conductor from '#models/conductor'
import Disputa from '#models/disputa'
import TicketSoporte from '#models/ticket_soporte'
import User from '#models/user'
import Viaje from '#models/viaje'

/**
 * El moderador solo maneja conductores:
 *  - directorio y ficha de los conductores de su zona (403 fuera de ella);
 *  - a un cliente lo contacta y ve sus datos solo con un ticket, un SOS o una
 *    disputa de por medio; sin caso, apenas el nombre corto;
 *  - lista de disputas de su zona (solo lectura);
 *  - "inactivos" deja fuera a pendientes y recién registrados.
 */

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')

const uniq = () => `${Date.now()}${Math.floor(Math.random() * 1e6)}`

async function login(client: any, email: string) {
  const res = await client.post('/api/auth/login').json({ email, password: 'Password123' })
  res.assertStatus(200)
  return res.body().token as string
}

async function crearUsuario(client: any, datos: Record<string, unknown>) {
  const user = await User.create({
    nombre: 'Test',
    apellido: 'Conductores',
    email: `cond_${uniq()}@test.com`,
    password: 'Password123',
    rol: 'cliente',
    ...datos,
  } as any)
  return { user, token: await login(client, user.email) }
}

const crearModerador = (client: any, zona: string | null) =>
  crearUsuario(client, { rol: 'moderador', esModerador: true, zonaModerador: zona })

async function crearConductor(client: any, ciudad: string, extra: Record<string, unknown> = {}) {
  const { user, token } = await crearUsuario(client, { rol: 'conductor', nombre: 'Pedro', apellido: 'Pérez' })
  const conductor = await Conductor.create({
    usuarioId: user.id,
    cedula: `${uniq()}`.slice(-10),
    placa: `CND${`${uniq()}`.slice(-3)}`,
    tipoVehiculo: 'camioneta',
    capacidad: '1 tonelada',
    ciudad,
    estadoVerificacion: 'aprobado',
    ...extra,
  } as any)
  return { user, token, conductor }
}

async function crearViaje(clienteId: number, conductorId: number | null, extra: Record<string, unknown> = {}) {
  return Viaje.create({
    clienteId,
    conductorId,
    estado: 'en_curso',
    origenDireccion: 'Parque Caldas, Popayán',
    origenLat: 2.4419,
    origenLng: -76.6063,
    destinoDireccion: 'Terminal, Popayán',
    destinoLat: 2.4569,
    destinoLng: -76.5952,
    precioCliente: 50000,
    precioEstimado: 50000,
    ...extra,
  } as any)
}

const crearDisputa = (viaje: Viaje, conductorId: number, clienteId: number) =>
  Disputa.create({
    viajeId: viaje.id,
    conductorId,
    clienteId,
    estado: 'abierta',
    versionConductor: 'previa',
  } as any)

const items = (body: any): any[] => (Array.isArray(body) ? body : Array.isArray(body?.data) ? body.data : [])
const ids = (body: any) => items(body).map((x: any) => Number(x.id))

test.group('Moderador: directorio y ficha de conductores', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('lista solo los conductores de su zona y busca por nombre, cédula o placa', async ({ client, assert }) => {
    const mod = await crearModerador(client, 'popayan')
    const enZona = await crearConductor(client, 'Popayán')
    const fuera = await crearConductor(client, 'Cali')

    const todos = await client.get('/api/moderator/drivers').bearerToken(mod.token)
    todos.assertStatus(200)
    assert.include(ids(todos.body()), enZona.conductor.id)
    assert.notInclude(ids(todos.body()), fuera.conductor.id)

    const porPlaca = await client.get(`/api/moderator/drivers?buscar=${enZona.conductor.placa.toLowerCase()}`).bearerToken(mod.token)
    porPlaca.assertStatus(200)
    assert.deepEqual(ids(porPlaca.body()), [enZona.conductor.id])

    const porCedula = await client.get(`/api/moderator/drivers?buscar=${enZona.conductor.cedula}`).bearerToken(mod.token)
    assert.deepEqual(ids(porCedula.body()), [enZona.conductor.id])

    const porNombre = await client.get('/api/moderator/drivers?buscar=pedro').bearerToken(mod.token)
    assert.include(ids(porNombre.body()), enZona.conductor.id)
    assert.notInclude(ids(porNombre.body()), fuera.conductor.id)
  })

  test('la ficha trae persona, vehículo, documentos, viajes y disputas; la foto del registro sirve de avatar', async ({ client, assert }) => {
    const mod = await crearModerador(client, 'popayan')
    const driver = await crearConductor(client, 'Popayán', { fotoConductor: 'conductores/foto.jpg', fotoVehiculo: 'vehiculos/v.jpg' })
    const cliente = await crearUsuario(client, { rol: 'cliente', nombre: 'Laura', apellido: 'Gómez' })
    const viaje = await crearViaje(cliente.user.id, driver.conductor.id)
    await crearDisputa(viaje, driver.conductor.id, cliente.user.id)

    const res = await client.get(`/api/moderator/drivers/${driver.conductor.id}`).bearerToken(mod.token)
    res.assertStatus(200)
    const b = res.body()
    assert.equal(b.id, driver.conductor.id)
    assert.equal(b.fotoConductor, 'conductores/foto.jpg')
    assert.equal(b.fotoVehiculo, 'vehiculos/v.jpg')
    assert.equal(b.placa, driver.conductor.placa)
    assert.equal(b.usuario.nombre, 'Pedro Pérez')
    assert.property(b.usuario, 'contactoEmergenciaTelefono')
    assert.property(b.documentos, 'fotoCedula')
    assert.deepEqual(ids(b.viajes), [Number(viaje.id)])
    assert.equal(b.viajes[0].cliente.nombre, 'Laura G.')
    assert.lengthOf(b.disputas, 1)
    assert.isArray(b.reportes)
  })

  test('la ficha de un conductor de otra zona da 403 y una inexistente 404', async ({ client }) => {
    const mod = await crearModerador(client, 'popayan')
    const fuera = await crearConductor(client, 'Cali')
    ;(await client.get(`/api/moderator/drivers/${fuera.conductor.id}`).bearerToken(mod.token)).assertStatus(403)
    ;(await client.get('/api/moderator/drivers/999999').bearerToken(mod.token)).assertStatus(404)
  })

  test('la foto pedida en el registro queda como avatar del usuario si no tenía', async ({ client, assert }) => {
    const driver = await crearConductor(client, 'Popayán')
    const res = await client
      .post('/api/drivers/driver-photo')
      .bearerToken(driver.token)
      .file('file', PNG, { filename: 'foto.png', contentType: 'image/png' })
    res.assertStatus(200)
    const user = await User.findOrFail(driver.user.id)
    const c = await Conductor.findOrFail(driver.conductor.id)
    assert.isString(c.fotoConductor)
    assert.equal(user.avatar, c.fotoConductor)
  })

  test('inactivos: solo aprobados con más de 7 días y con la fecha del último viaje', async ({ client, assert }) => {
    const mod = await crearModerador(client, 'popayan')
    const hace30 = DateTime.now().minus({ days: 30 }).toFormat('yyyy-MM-dd HH:mm:ss')
    const viejo = await crearConductor(client, 'Popayán', { online: false })
    const pendiente = await crearConductor(client, 'Popayán', { online: false, estadoVerificacion: 'pendiente' })
    const nuevo = await crearConductor(client, 'Popayán', { online: false })
    await Conductor.query().whereIn('id', [viejo.conductor.id, pendiente.conductor.id]).update({ created_at: hace30 })
    const cliente = await crearUsuario(client, { rol: 'cliente' })
    const viaje = await crearViaje(cliente.user.id, viejo.conductor.id, { estado: 'finalizado' })
    await Viaje.query().where('id', viaje.id).update({ created_at: hace30 })

    const res = await client.get('/api/moderator/drivers/inactive').bearerToken(mod.token)
    res.assertStatus(200)
    const lista = items(res.body())
    const fila = lista.find((c: any) => c.id === viejo.conductor.id)
    assert.exists(fila)
    assert.isString(fila.ultimoViajeAt)
    assert.notInclude(ids(lista), pendiente.conductor.id)
    assert.notInclude(ids(lista), nuevo.conductor.id)
  })
})

test.group('Moderador: clientes solo con ticket, SOS o disputa', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('crear conversación con un cliente sin caso da 403; con ticket de su zona, 200', async ({ client }) => {
    const mod = await crearModerador(client, 'popayan')
    const cliente = await crearUsuario(client, { rol: 'cliente' })
    const sinCaso = await client.post('/api/moderator/conversations').bearerToken(mod.token).json({ usuarioId: cliente.user.id })
    sinCaso.assertStatus(403)

    await TicketSoporte.create({ usuarioId: cliente.user.id, categoria: 'otro', asunto: 'Ayuda', descripcion: 'Prueba', estado: 'abierto', zona: 'cali' } as any)
    ;(await client.post('/api/moderator/conversations').bearerToken(mod.token).json({ usuarioId: cliente.user.id })).assertStatus(403)

    await TicketSoporte.create({ usuarioId: cliente.user.id, categoria: 'otro', asunto: 'Ayuda', descripcion: 'Prueba', estado: 'abierto', zona: 'popayan' } as any)
    ;(await client.post('/api/moderator/conversations').bearerToken(mod.token).json({ usuarioId: cliente.user.id })).assertStatus(200)
  })

  test('un SOS o una disputa con un conductor de su zona también habilitan el chat', async ({ client }) => {
    const mod = await crearModerador(client, 'popayan')
    const driver = await crearConductor(client, 'Popayán')
    const porSos = await crearUsuario(client, { rol: 'cliente' })
    const viaje = await crearViaje(porSos.user.id, driver.conductor.id)
    await AlertaEmergencia.create({ userId: porSos.user.id, viajeId: viaje.id, lat: 2.44, lng: -76.6, motivo: 'Prueba', estado: 'pendiente', atendida: false } as any)
    ;(await client.post('/api/moderator/conversations').bearerToken(mod.token).json({ usuarioId: porSos.user.id })).assertStatus(200)

    const porDisputa = await crearUsuario(client, { rol: 'cliente' })
    const viaje2 = await crearViaje(porDisputa.user.id, driver.conductor.id, { estado: 'disputa' })
    await crearDisputa(viaje2, driver.conductor.id, porDisputa.user.id)
    ;(await client.post('/api/moderator/conversations').bearerToken(mod.token).json({ usuarioId: porDisputa.user.id })).assertStatus(200)
  })

  test('contactable-users no devuelve clientes al moderador aunque los busque por nombre', async ({ client, assert }) => {
    const mod = await crearModerador(client, 'popayan')
    const cliente = await crearUsuario(client, { rol: 'cliente', nombre: 'Clientazo', apellido: 'Único' })
    const driver = await crearConductor(client, 'Popayán')
    const res = await client.get('/api/moderator/contactable-users?q=clientazo').bearerToken(mod.token)
    res.assertStatus(200)
    assert.notInclude(ids(res.body()), cliente.user.id)
    const todos = await client.get('/api/moderator/contactable-users').bearerToken(mod.token)
    assert.include(ids(todos.body()), driver.user.id)
    assert.notInclude(ids(todos.body()), cliente.user.id)
  })

  test('en viajes el cliente sale con nombre corto y sin teléfono, salvo que el viaje tenga un caso', async ({ client, assert }) => {
    const mod = await crearModerador(client, 'popayan')
    const driver = await crearConductor(client, 'Popayán')
    const cliente = await crearUsuario(client, { rol: 'cliente', nombre: 'Laura', apellido: 'Gómez', telefono: '3001234567' })
    const normal = await crearViaje(cliente.user.id, driver.conductor.id)
    const conDisputa = await crearViaje(cliente.user.id, driver.conductor.id, { estado: 'disputa' })
    await crearDisputa(conDisputa, driver.conductor.id, cliente.user.id)

    const lista = await client.get('/api/moderator/trips?limit=100').bearerToken(mod.token)
    lista.assertStatus(200)
    const filaNormal = items(lista.body()).find((t: any) => Number(t.id) === Number(normal.id))
    const filaDisputa = items(lista.body()).find((t: any) => Number(t.id) === Number(conDisputa.id))
    assert.equal(filaNormal.cliente.nombre, 'Laura G.')
    assert.isNull(filaNormal.cliente.telefono)
    assert.isFalse(filaNormal.contactoVisible)
    assert.isTrue(filaDisputa.contactoVisible)
    assert.isTrue(filaDisputa.tieneDisputa)
    assert.equal(filaDisputa.cliente.telefono, '3001234567')

    const detalle = await client.get(`/api/moderator/trips/${normal.id}`).bearerToken(mod.token)
    detalle.assertStatus(200)
    assert.isNull(detalle.body().cliente.telefono)
    assert.isFalse(detalle.body().contactoVisible)

    const detalleDisputa = await client.get(`/api/moderator/trips/${conDisputa.id}`).bearerToken(mod.token)
    assert.equal(detalleDisputa.body().cliente.telefono, '3001234567')
    assert.equal(detalleDisputa.body().disputa.estado, 'abierta')
  })
})

test.group('Moderador: disputas de su zona', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('lista solo las disputas de conductores de su zona, con filtro por estado', async ({ client, assert }) => {
    const mod = await crearModerador(client, 'popayan')
    const enZona = await crearConductor(client, 'Popayán')
    const fuera = await crearConductor(client, 'Cali')
    const cliente = await crearUsuario(client, { rol: 'cliente' })
    const v1 = await crearViaje(cliente.user.id, enZona.conductor.id, { estado: 'disputa' })
    const v2 = await crearViaje(cliente.user.id, fuera.conductor.id, { estado: 'disputa' })
    const propia = await crearDisputa(v1, enZona.conductor.id, cliente.user.id)
    const ajena = await crearDisputa(v2, fuera.conductor.id, cliente.user.id)

    const res = await client.get('/api/moderator/disputes').bearerToken(mod.token)
    res.assertStatus(200)
    assert.include(ids(res.body()), propia.id)
    assert.notInclude(ids(res.body()), ajena.id)
    const fila = items(res.body()).find((d: any) => d.id === propia.id)
    assert.equal(fila.conductor.placa, enZona.conductor.placa)
    assert.equal(Number(fila.viaje.id), Number(v1.id))

    const resueltas = await client.get('/api/moderator/disputes?estado=resuelta').bearerToken(mod.token)
    resueltas.assertStatus(200)
    assert.notInclude(ids(resueltas.body()), propia.id)
  })

  test('sin zona asignada responde 403', async ({ client }) => {
    const mod = await crearModerador(client, null)
    ;(await client.get('/api/moderator/disputes').bearerToken(mod.token)).assertStatus(403)
  })
})
