import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import { io, type Socket } from 'socket.io-client'
import Conductor from '#models/conductor'
import Notificacion from '#models/notificacion'
import TicketMensaje from '#models/ticket_mensaje'
import TicketSoporte from '#models/ticket_soporte'
import User from '#models/user'
import Viaje from '#models/viaje'

/**
 * Tickets de soporte: el usuario (cliente/conductor) abre un caso y lo atiende
 * un moderador de su zona o el admin por un hilo de mensajes.
 *
 *  - Usuario:   /api/support/tickets     (solo ve los suyos)
 *  - Moderador: /api/moderator/tickets   (solo su zona)
 *  - Admin:     /api/admin/tickets       (todas las zonas, asigna moderador)
 */

const URL = `http://localhost:${process.env.PORT ?? 3333}`
const uniq = () => `${Date.now()}${Math.floor(Math.random() * 1e6)}`
const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms))

// PNG 1x1 válido.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
)

const TICKET = {
  categoria: 'pago',
  asunto: 'Cobro duplicado',
  descripcion: 'Me cobraron dos veces el mismo viaje del martes.',
}

async function registrarCliente(client: any) {
  const res = await client.post('/api/auth/register').json({
    nombre: 'Cli',
    apellido: 'Ticket',
    email: `tk_cli_${uniq()}@test.com`,
    password: 'Password123',
    rol: 'cliente',
    edad: 30,
  })
  res.assertStatus(200)
  return { id: Number(res.body().id), token: res.body().token as string }
}

async function registrarConductor(client: any, ciudad = 'popayan') {
  const res = await client.post('/api/auth/register').json({
    nombre: 'Con',
    apellido: 'Ticket',
    email: `tk_con_${uniq()}@test.com`,
    password: 'Password123',
    rol: 'conductor',
    edad: 35,
    cedula: `${uniq()}`.slice(-10),
    placa: `TKT${`${uniq()}`.slice(-4)}`,
    tipoVehiculo: 'camioneta',
    capacidad: '1 tonelada',
    ciudad,
  })
  res.assertStatus(200)
  const usuarioId = Number(res.body().id)
  const conductor = await Conductor.findByOrFail('usuario_id', usuarioId)
  return { token: res.body().token as string, conductorId: conductor.id, id: usuarioId }
}

async function login(client: any, email: string) {
  const res = await client.post('/api/auth/login').json({ email, password: 'Password123' })
  res.assertStatus(200)
  return res.body().token as string
}

async function crearModerador(client: any, zona: string | null) {
  const user = await User.create({
    nombre: 'Mod',
    apellido: zona || 'SinZona',
    email: `tk_mod_${uniq()}@test.com`,
    password: 'Password123',
    rol: 'moderador',
    esModerador: true,
    zonaModerador: zona,
  })
  return { id: user.id, token: await login(client, user.email) }
}

async function crearAdmin(client: any) {
  const user = await User.create({
    nombre: 'Admin',
    apellido: 'Ticket',
    email: `tk_admin_${uniq()}@test.com`,
    password: 'Password123',
    rol: 'admin',
  })
  return { id: user.id, token: await login(client, user.email) }
}

async function crearViaje(clienteId: number, conductorId: number | null, estado = 'finalizado') {
  return Viaje.create({
    clienteId,
    conductorId,
    estado,
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

/** Cliente con un viaje finalizado con un conductor de Popayán y un ticket sobre ese viaje. */
async function clienteConTicket(client: any, extra: Record<string, unknown> = {}) {
  const cliente = await registrarCliente(client)
  const conductor = await registrarConductor(client, 'popayan')
  const viaje = await crearViaje(cliente.id, conductor.conductorId)
  const res = await client
    .post('/api/support/tickets')
    .bearerToken(cliente.token)
    .json({ ...TICKET, viajeId: viaje.id, ...extra })
  res.assertStatus(201)
  return { cliente, conductor, viaje, ticket: res.body() }
}

function conectar(token: string): Promise<Socket> {
  const socket = io(URL, { transports: ['websocket'], auth: { token: `Bearer ${token}` }, query: { token } })
  return new Promise((resolve, reject) => {
    socket.once('connect', () => resolve(socket))
    socket.once('connect_error', reject)
  })
}

test.group('Tickets de soporte - usuario', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('el cliente crea un ticket sobre su viaje y la zona sale del conductor', async ({ client, assert }) => {
    const { cliente, viaje, ticket } = await clienteConTicket(client)

    assert.equal(ticket.estado, 'abierto')
    assert.equal(ticket.categoria, 'pago')
    assert.equal(ticket.asunto, TICKET.asunto)
    assert.equal(ticket.zona, 'popayan')
    assert.equal(ticket.viajeId, viaje.id)
    assert.equal(ticket.viaje.origenDireccion, 'Parque Caldas, Popayán')
    assert.equal(ticket.usuario.id, cliente.id)
    assert.isNull(ticket.moderador)
    assert.isNull(ticket.adjunto)
    assert.deepEqual(ticket.mensajes, [])
    // Al dueño no se le exponen datos de contacto de nadie.
    assert.notProperty(ticket.usuario, 'email')

    const guardado = await TicketSoporte.findOrFail(ticket.id)
    assert.equal(guardado.usuarioId, cliente.id)
    assert.equal(guardado.zona, 'popayan')
  })

  test('el conductor crea un ticket sin viaje y la zona es su ciudad', async ({ client, assert }) => {
    const conductor = await registrarConductor(client, 'Popayán')
    const res = await client
      .post('/api/support/tickets')
      .bearerToken(conductor.token)
      .json({ categoria: 'cuenta', asunto: 'No puedo conectarme', descripcion: 'La app dice que mi cuenta está inactiva.' })
    res.assertStatus(201)
    assert.equal(res.body().zona, 'popayan')
    assert.isNull(res.body().viajeId)
  })

  test('cliente sin viajes: usa la zona sugerida por la app o queda sin zona', async ({ client, assert }) => {
    const cliente = await registrarCliente(client)
    const conZona = await client
      .post('/api/support/tickets')
      .bearerToken(cliente.token)
      .json({ categoria: 'app', asunto: 'Error al abrir', descripcion: 'La app se cierra sola al abrir el mapa.', zona: 'Popayán' })
    conZona.assertStatus(201)
    assert.equal(conZona.body().zona, 'popayan')

    const sinZona = await client
      .post('/api/support/tickets')
      .bearerToken(cliente.token)
      .json({ categoria: 'otro', asunto: 'Consulta general', descripcion: 'Quiero saber cómo funcionan las reservas.' })
    sinZona.assertStatus(201)
    assert.isNull(sinZona.body().zona)
  })

  test('valida categoría, asunto y descripción (422)', async ({ client, assert }) => {
    const cliente = await registrarCliente(client)
    const post = (body: Record<string, unknown>) =>
      client.post('/api/support/tickets').bearerToken(cliente.token).json(body)

    const categoria = await post({ ...TICKET, categoria: 'reclamo' })
    categoria.assertStatus(422)
    assert.include(categoria.body().error, 'categoria')

    const asunto = await post({ ...TICKET, asunto: 'ab' })
    asunto.assertStatus(422)
    assert.include(asunto.body().error, 'asunto')

    const descripcion = await post({ ...TICKET, descripcion: 'corta' })
    descripcion.assertStatus(422)
    assert.include(descripcion.body().error, 'descripcion')

    assert.equal(await TicketSoporte.query().where('usuario_id', cliente.id).count('* as t').first().then((r) => Number(r?.$extras.t)), 0)
  })

  test('el viaje debe existir y ser del usuario (404/403); el admin no abre tickets (403)', async ({ client }) => {
    const cliente = await registrarCliente(client)
    const otro = await registrarCliente(client)
    const conductor = await registrarConductor(client)
    const viajeAjeno = await crearViaje(otro.id, conductor.conductorId)

    ;(await client.post('/api/support/tickets').bearerToken(cliente.token).json({ ...TICKET, viajeId: 999999999 })).assertStatus(404)
    ;(await client.post('/api/support/tickets').bearerToken(cliente.token).json({ ...TICKET, viajeId: viajeAjeno.id })).assertStatus(403)

    const admin = await crearAdmin(client)
    ;(await client.post('/api/support/tickets').bearerToken(admin.token).json(TICKET)).assertStatus(403)
  })

  test('cada usuario lista solo sus tickets y puede filtrar por estado', async ({ client, assert }) => {
    const a = await clienteConTicket(client)
    const b = await clienteConTicket(client, { asunto: 'Otro asunto' })

    const listaA = await client.get('/api/support/tickets').bearerToken(a.cliente.token)
    listaA.assertStatus(200)
    assert.lengthOf(listaA.body().tickets, 1)
    assert.equal(listaA.body().tickets[0].id, a.ticket.id)
    assert.equal(listaA.body().meta.total, 1)

    const listaB = await client.get('/api/support/tickets').bearerToken(b.cliente.token)
    assert.lengthOf(listaB.body().tickets, 1)
    assert.equal(listaB.body().tickets[0].id, b.ticket.id)

    const cerrados = await client.get('/api/support/tickets?estado=cerrado').bearerToken(a.cliente.token)
    cerrados.assertStatus(200)
    assert.lengthOf(cerrados.body().tickets, 0)

    const invalido = await client.get('/api/support/tickets?estado=pendiente').bearerToken(a.cliente.token)
    invalido.assertStatus(422)
  })

  test('un usuario no ve, ni escribe, ni cierra tickets ajenos (404)', async ({ client }) => {
    const { ticket } = await clienteConTicket(client)
    const intruso = await registrarCliente(client)

    ;(await client.get(`/api/support/tickets/${ticket.id}`).bearerToken(intruso.token)).assertStatus(404)
    ;(await client.post(`/api/support/tickets/${ticket.id}/messages`).bearerToken(intruso.token).json({ mensaje: 'hola' })).assertStatus(404)
    ;(await client.post(`/api/support/tickets/${ticket.id}/close`).bearerToken(intruso.token)).assertStatus(404)
    ;(await client.get('/api/support/tickets/abc').bearerToken(intruso.token)).assertStatus(404)
  })

  test('el usuario escribe en el hilo y lo ve en el detalle', async ({ client, assert }) => {
    const { cliente, ticket } = await clienteConTicket(client)

    const vacio = await client.post(`/api/support/tickets/${ticket.id}/messages`).bearerToken(cliente.token).json({ mensaje: '   ' })
    vacio.assertStatus(422)

    const msg = await client
      .post(`/api/support/tickets/${ticket.id}/messages`)
      .bearerToken(cliente.token)
      .json({ mensaje: 'Adjunto más datos del cobro.' })
    msg.assertStatus(201)
    assert.equal(msg.body().rolAutor, 'usuario')
    assert.equal(msg.body().autor.id, cliente.id)
    assert.equal(msg.body().ticketEstado, 'abierto')

    const detalle = await client.get(`/api/support/tickets/${ticket.id}`).bearerToken(cliente.token)
    detalle.assertStatus(200)
    assert.lengthOf(detalle.body().mensajes, 1)
    assert.equal(detalle.body().mensajes[0].mensaje, 'Adjunto más datos del cobro.')
    assert.equal(detalle.body().totalMensajes, 1)
    assert.isNotNull(detalle.body().ultimoMensajeAt)
  })

  test('el usuario cierra su ticket; cerrado no admite mensajes ni cerrarse de nuevo', async ({ client, assert }) => {
    const { cliente, ticket } = await clienteConTicket(client)

    const cierre = await client.post(`/api/support/tickets/${ticket.id}/close`).bearerToken(cliente.token)
    cierre.assertStatus(200)
    assert.equal(cierre.body().estado, 'cerrado')
    assert.isNotNull(cierre.body().cerradoAt)

    ;(await client.post(`/api/support/tickets/${ticket.id}/messages`).bearerToken(cliente.token).json({ mensaje: 'hola' })).assertStatus(422)
    ;(await client.post(`/api/support/tickets/${ticket.id}/close`).bearerToken(cliente.token)).assertStatus(422)
  })

  test('adjunto: se sube aparte o en el mismo POST y se sirve solo con URL firmada', async ({ client, assert }) => {
    const cliente = await registrarCliente(client)

    const subida = await client
      .post('/api/support/tickets/upload')
      .bearerToken(cliente.token)
      .file('file', PNG, { filename: 'pantallazo.png', contentType: 'image/png' })
    subida.assertStatus(200)
    assert.match(subida.body().adjunto, /^\/storage\/uploads\/ticket-[0-9a-f-]+\.png$/)
    assert.include(subida.body().url, 'sig=')

    const conRuta = await client
      .post('/api/support/tickets')
      .bearerToken(cliente.token)
      .json({ ...TICKET, adjunto: subida.body().url, zona: 'popayan' })
    conRuta.assertStatus(201)
    assert.include(conRuta.body().adjunto, subida.body().adjunto)
    assert.include(conRuta.body().adjunto, 'sig=')
    const guardado = await TicketSoporte.findOrFail(conRuta.body().id)
    assert.equal(guardado.adjunto, subida.body().adjunto)

    // Sin firma el archivo es privado.
    ;(await client.get(subida.body().adjunto)).assertStatus(403)
    ;(await client.get(subida.body().url)).assertStatus(200)

    // Multipart directo en la creación.
    const multipart = await client
      .post('/api/support/tickets')
      .bearerToken(cliente.token)
      .fields({ ...TICKET, zona: 'popayan' })
      .file('file', PNG, { filename: 'foto.png', contentType: 'image/png' })
    multipart.assertStatus(201)
    assert.match(multipart.body().adjunto, /ticket-[0-9a-f-]+\.png\?exp=/)

    // Mensaje con adjunto multipart.
    const msg = await client
      .post(`/api/support/tickets/${multipart.body().id}/messages`)
      .bearerToken(cliente.token)
      .fields({ mensaje: 'Otra foto' })
      .file('file', PNG, { filename: 'foto2.png', contentType: 'image/png' })
    msg.assertStatus(201)
    assert.include(msg.body().adjunto, 'sig=')

    // Solo imágenes.
    const pdf = await client
      .post('/api/support/tickets/upload')
      .bearerToken(cliente.token)
      .file('file', Buffer.from('%PDF-1.4'), { filename: 'doc.pdf', contentType: 'application/pdf' })
    pdf.assertStatus(422)

    const rutaInvalida = await client
      .post('/api/support/tickets')
      .bearerToken(cliente.token)
      .json({ ...TICKET, adjunto: '../../etc/passwd' })
    rutaInvalida.assertStatus(422)

    ;(await client.post('/api/support/tickets/upload').bearerToken(cliente.token)).assertStatus(400)
  })
})

test.group('Tickets de soporte - moderador', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('la bandeja muestra solo la zona del moderador y filtra por estado', async ({ client, assert }) => {
    const popayan = await clienteConTicket(client)
    const cali = await registrarConductor(client, 'cali')
    const deCali = await client
      .post('/api/support/tickets')
      .bearerToken(cali.token)
      .json({ categoria: 'viaje', asunto: 'Viaje en Cali', descripcion: 'El cliente no apareció en el punto.' })
    deCali.assertStatus(201)
    assert.equal(deCali.body().zona, 'cali')

    const modPopayan = await crearModerador(client, 'Popayán')
    const bandeja = await client.get('/api/moderator/tickets').bearerToken(modPopayan.token)
    bandeja.assertStatus(200)
    assert.lengthOf(bandeja.body().tickets, 1)
    assert.equal(bandeja.body().tickets[0].id, popayan.ticket.id)
    // El staff sí ve el contacto del usuario.
    assert.property(bandeja.body().tickets[0].usuario, 'email')

    const modCali = await crearModerador(client, 'cali')
    const bandejaCali = await client.get('/api/moderator/tickets').bearerToken(modCali.token)
    assert.lengthOf(bandejaCali.body().tickets, 1)
    assert.equal(bandejaCali.body().tickets[0].id, deCali.body().id)

    const enProceso = await client.get('/api/moderator/tickets?estado=en_proceso').bearerToken(modPopayan.token)
    assert.lengthOf(enProceso.body().tickets, 0)
    const abiertos = await client.get('/api/moderator/tickets?estado=abierto,en_proceso').bearerToken(modPopayan.token)
    assert.lengthOf(abiertos.body().tickets, 1)

    const conteo = await client.get('/api/moderator/tickets/count').bearerToken(modPopayan.token)
    conteo.assertStatus(200)
    assert.deepEqual(conteo.body(), { abiertos: 1, enProceso: 0, total: 1 })
  })

  test('un moderador de otra zona no ve, toma, responde ni cambia estado (403)', async ({ client }) => {
    const { ticket } = await clienteConTicket(client)
    const modCali = await crearModerador(client, 'cali')
    const t = modCali.token

    ;(await client.get(`/api/moderator/tickets/${ticket.id}`).bearerToken(t)).assertStatus(403)
    ;(await client.post(`/api/moderator/tickets/${ticket.id}/take`).bearerToken(t)).assertStatus(403)
    ;(await client.post(`/api/moderator/tickets/${ticket.id}/messages`).bearerToken(t).json({ mensaje: 'hola' })).assertStatus(403)
    ;(await client.put(`/api/moderator/tickets/${ticket.id}/status`).bearerToken(t).json({ estado: 'resuelto' })).assertStatus(403)
    ;(await client.get('/api/moderator/tickets/999999999').bearerToken(t)).assertStatus(404)
  })

  test('un ticket sin zona solo lo ve el admin', async ({ client, assert }) => {
    const cliente = await registrarCliente(client)
    const res = await client.post('/api/support/tickets').bearerToken(cliente.token).json(TICKET)
    res.assertStatus(201)
    assert.isNull(res.body().zona)

    const mod = await crearModerador(client, 'popayan')
    ;(await client.get(`/api/moderator/tickets/${res.body().id}`).bearerToken(mod.token)).assertStatus(403)
    const bandeja = await client.get('/api/moderator/tickets').bearerToken(mod.token)
    assert.lengthOf(bandeja.body().tickets, 0)

    const admin = await crearAdmin(client)
    ;(await client.get(`/api/admin/tickets/${res.body().id}`).bearerToken(admin.token)).assertStatus(200)
  })

  test('sin zona asignada o sin ser moderador no hay acceso (403)', async ({ client }) => {
    const sinZona = await crearModerador(client, null)
    ;(await client.get('/api/moderator/tickets').bearerToken(sinZona.token)).assertStatus(403)
    const cliente = await registrarCliente(client)
    ;(await client.get('/api/moderator/tickets').bearerToken(cliente.token)).assertStatus(403)
  })

  test('tomar el ticket lo asigna y lo pasa a en_proceso; otro moderador recibe 409', async ({ client, assert }) => {
    const { cliente, ticket } = await clienteConTicket(client)
    const mod1 = await crearModerador(client, 'popayan')
    const mod2 = await crearModerador(client, 'popayan')

    const tomado = await client.post(`/api/moderator/tickets/${ticket.id}/take`).bearerToken(mod1.token)
    tomado.assertStatus(200)
    assert.equal(tomado.body().estado, 'en_proceso')
    assert.equal(tomado.body().moderador.id, mod1.id)

    ;(await client.post(`/api/moderator/tickets/${ticket.id}/take`).bearerToken(mod2.token)).assertStatus(409)
    // Volver a tomarlo uno mismo es idempotente.
    ;(await client.post(`/api/moderator/tickets/${ticket.id}/take`).bearerToken(mod1.token)).assertStatus(200)

    // El dueño ve quién lo atiende (solo nombre).
    const detalle = await client.get(`/api/support/tickets/${ticket.id}`).bearerToken(cliente.token)
    assert.equal(detalle.body().moderador.id, mod1.id)
    assert.notProperty(detalle.body().moderador, 'zona')

    const notificacion = await Notificacion.query().where('usuario_id', cliente.id).where('tipo', 'ticket_estado').first()
    assert.isNotNull(notificacion)
  })

  test('responder asigna al moderador, pasa a en_proceso y notifica al usuario', async ({ client, assert }) => {
    const { cliente, ticket } = await clienteConTicket(client)
    const mod = await crearModerador(client, 'popayan')

    const res = await client
      .post(`/api/moderator/tickets/${ticket.id}/messages`)
      .bearerToken(mod.token)
      .json({ mensaje: 'Hola, ya estamos revisando el cobro.' })
    res.assertStatus(201)
    assert.equal(res.body().rolAutor, 'moderador')
    assert.equal(res.body().ticketEstado, 'en_proceso')
    assert.equal(res.body().moderadorId, mod.id)

    const guardado = await TicketSoporte.findOrFail(ticket.id)
    assert.equal(guardado.moderadorId, mod.id)
    assert.equal(guardado.estado, 'en_proceso')

    const notificacion = await Notificacion.query().where('usuario_id', cliente.id).where('tipo', 'ticket_mensaje').first()
    assert.isNotNull(notificacion)
    assert.equal(notificacion!.titulo, `Respuesta a tu ticket #${ticket.id}`)

    const detalle = await client.get(`/api/support/tickets/${ticket.id}`).bearerToken(cliente.token)
    assert.lengthOf(detalle.body().mensajes, 1)
    assert.equal(detalle.body().mensajes[0].rolAutor, 'moderador')
    assert.equal(detalle.body().mensajes[0].autor.id, mod.id)
  })

  test('cambia el estado con validación; el usuario reabre al escribir en un ticket resuelto', async ({ client, assert }) => {
    const { cliente, ticket } = await clienteConTicket(client)
    const mod = await crearModerador(client, 'popayan')

    ;(await client.put(`/api/moderator/tickets/${ticket.id}/status`).bearerToken(mod.token).json({ estado: 'pendiente' })).assertStatus(422)

    const resuelto = await client.put(`/api/moderator/tickets/${ticket.id}/status`).bearerToken(mod.token).json({ estado: 'resuelto' })
    resuelto.assertStatus(200)
    assert.equal(resuelto.body().estado, 'resuelto')
    assert.isNotNull(resuelto.body().resueltoAt)
    assert.equal(resuelto.body().moderador.id, mod.id)

    const reabre = await client
      .post(`/api/support/tickets/${ticket.id}/messages`)
      .bearerToken(cliente.token)
      .json({ mensaje: 'Sigue igual, no me devolvieron nada.' })
    reabre.assertStatus(201)
    assert.equal(reabre.body().ticketEstado, 'en_proceso')
    assert.isNull((await TicketSoporte.findOrFail(ticket.id)).resueltoAt)

    const cerrado = await client.put(`/api/moderator/tickets/${ticket.id}/status`).bearerToken(mod.token).json({ estado: 'cerrado' })
    cerrado.assertStatus(200)
    ;(await client.post(`/api/moderator/tickets/${ticket.id}/messages`).bearerToken(mod.token).json({ mensaje: 'x' })).assertStatus(422)
    ;(await client.post(`/api/moderator/tickets/${ticket.id}/take`).bearerToken(mod.token)).assertStatus(422)

    // Reabrir limpia las marcas de cierre.
    const reabierto = await client.put(`/api/moderator/tickets/${ticket.id}/status`).bearerToken(mod.token).json({ estado: 'abierto' })
    reabierto.assertStatus(200)
    assert.isNull(reabierto.body().cerradoAt)
  })
})

test.group('Tickets de soporte - admin', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('ve todos los tickets y filtra por zona y estado', async ({ client, assert }) => {
    const popayan = await clienteConTicket(client)
    const cali = await registrarConductor(client, 'cali')
    const deCali = await client
      .post('/api/support/tickets')
      .bearerToken(cali.token)
      .json({ categoria: 'viaje', asunto: 'Viaje en Cali', descripcion: 'El cliente no apareció en el punto.' })
    deCali.assertStatus(201)
    const admin = await crearAdmin(client)

    const todos = await client.get('/api/admin/tickets').bearerToken(admin.token)
    todos.assertStatus(200)
    assert.lengthOf(todos.body().tickets, 2)

    const soloCali = await client.get('/api/admin/tickets?zona=Cali').bearerToken(admin.token)
    assert.lengthOf(soloCali.body().tickets, 1)
    assert.equal(soloCali.body().tickets[0].id, deCali.body().id)

    ;(await client.post(`/api/support/tickets/${popayan.ticket.id}/close`).bearerToken(popayan.cliente.token)).assertStatus(200)
    const cerrados = await client.get('/api/admin/tickets?estado=cerrado').bearerToken(admin.token)
    assert.lengthOf(cerrados.body().tickets, 1)
    assert.equal(cerrados.body().tickets[0].id, popayan.ticket.id)

    const conteo = await client.get('/api/admin/tickets/count').bearerToken(admin.token)
    assert.deepEqual(conteo.body(), { abiertos: 1, enProceso: 0, total: 1 })

    // Un moderador no entra por las rutas de admin.
    const mod = await crearModerador(client, 'popayan')
    ;(await client.get('/api/admin/tickets').bearerToken(mod.token)).assertStatus(403)
  })

  test('asigna moderador (de la zona), lo quita y responde como admin', async ({ client, assert }) => {
    const { cliente, ticket } = await clienteConTicket(client)
    const admin = await crearAdmin(client)
    const modPopayan = await crearModerador(client, 'popayan')
    const modCali = await crearModerador(client, 'cali')

    ;(await client.put(`/api/admin/tickets/${ticket.id}/assign`).bearerToken(admin.token).json({ moderadorId: cliente.id })).assertStatus(422)
    ;(await client.put(`/api/admin/tickets/${ticket.id}/assign`).bearerToken(admin.token).json({ moderadorId: modCali.id })).assertStatus(422)

    const asignado = await client.put(`/api/admin/tickets/${ticket.id}/assign`).bearerToken(admin.token).json({ moderadorId: modPopayan.id })
    asignado.assertStatus(200)
    assert.equal(asignado.body().moderador.id, modPopayan.id)
    assert.equal(asignado.body().estado, 'en_proceso')

    // Otros specs dejan moderadores de Popayán en la BD: se comprueba pertenencia, no igualdad.
    const moderadores = await client.get('/api/admin/tickets/moderators?zona=popayan').bearerToken(admin.token)
    moderadores.assertStatus(200)
    const ids = moderadores.body().moderadores.map((m: any) => m.id)
    assert.include(ids, modPopayan.id)
    assert.notInclude(ids, modCali.id)
    assert.notInclude(ids, admin.id)

    const quitado = await client.put(`/api/admin/tickets/${ticket.id}/assign`).bearerToken(admin.token).json({ moderadorId: null })
    quitado.assertStatus(200)
    assert.isNull(quitado.body().moderador)

    const msg = await client
      .post(`/api/admin/tickets/${ticket.id}/messages`)
      .bearerToken(admin.token)
      .json({ mensaje: 'Te respondemos desde administración.' })
    msg.assertStatus(201)
    assert.equal(msg.body().rolAutor, 'admin')
    // El admin no se auto-asigna.
    assert.isNull(msg.body().moderadorId)

    const guardado = await TicketMensaje.findOrFail(msg.body().id)
    assert.equal(guardado.autorId, admin.id)

    // El admin puede tomar un ticket aunque otro moderador lo tenga.
    ;(await client.post(`/api/moderator/tickets/${ticket.id}/take`).bearerToken(modPopayan.token)).assertStatus(200)
    ;(await client.post(`/api/admin/tickets/${ticket.id}/take`).bearerToken(admin.token)).assertStatus(200)
    assert.equal((await TicketSoporte.findOrFail(ticket.id)).moderadorId, admin.id)
  })
})

test.group('Tickets de soporte - tiempo real', () => {
  test('ticket:nuevo llega a moderadores de la zona y al admin; ticket:mensaje va al usuario y al moderador asignado', async ({
    client,
    assert,
  }) => {
    const cliente = await registrarCliente(client)
    const conductor = await registrarConductor(client, 'popayan')
    const viaje = await crearViaje(cliente.id, conductor.conductorId)
    const admin = await crearAdmin(client)
    const modPopayan = await crearModerador(client, 'popayan')
    const modCali = await crearModerador(client, 'cali')

    const sockets = {
      cliente: await conectar(cliente.token),
      admin: await conectar(admin.token),
      modPopayan: await conectar(modPopayan.token),
      modCali: await conectar(modCali.token),
    }
    const recibidos: Record<string, any[]> = {}
    for (const [nombre, socket] of Object.entries(sockets)) {
      for (const evento of ['ticket:nuevo', 'ticket:mensaje', 'ticket:estado']) {
        socket.on(evento, (d) => (recibidos[`${nombre}/${evento}`] ||= []).push(d))
      }
    }
    await esperar(200)

    try {
      const creado = await client
        .post('/api/support/tickets')
        .bearerToken(cliente.token)
        .json({ ...TICKET, viajeId: viaje.id })
      creado.assertStatus(201)
      const ticketId = creado.body().id
      await esperar(400)

      assert.lengthOf(recibidos['modPopayan/ticket:nuevo'] || [], 1)
      assert.lengthOf(recibidos['admin/ticket:nuevo'] || [], 1)
      assert.lengthOf(recibidos['modCali/ticket:nuevo'] || [], 0)
      assert.equal(recibidos['modPopayan/ticket:nuevo'][0].id, ticketId)
      assert.equal(recibidos['modPopayan/ticket:nuevo'][0].usuario.id, cliente.id)

      // El moderador responde: el usuario recibe ticket:mensaje (y ticket:estado por pasar a en_proceso).
      const respuesta = await client
        .post(`/api/moderator/tickets/${ticketId}/messages`)
        .bearerToken(modPopayan.token)
        .json({ mensaje: 'Estamos revisando.' })
      respuesta.assertStatus(201)
      await esperar(400)

      const alCliente = recibidos['cliente/ticket:mensaje'] || []
      assert.lengthOf(alCliente, 1)
      assert.equal(alCliente[0].ticketId, ticketId)
      assert.equal(alCliente[0].estado, 'en_proceso')
      assert.equal(alCliente[0].mensaje.rolAutor, 'moderador')
      assert.equal(alCliente[0].mensaje.mensaje, 'Estamos revisando.')
      assert.lengthOf(recibidos['modCali/ticket:mensaje'] || [], 0)

      // El usuario contesta: le llega al moderador asignado (una sola vez) y al admin, no a otra zona.
      const contesta = await client
        .post(`/api/support/tickets/${ticketId}/messages`)
        .bearerToken(cliente.token)
        .json({ mensaje: 'Gracias, quedo atento.' })
      contesta.assertStatus(201)
      await esperar(400)

      const alMod = (recibidos['modPopayan/ticket:mensaje'] || []).filter((d) => d.mensaje.rolAutor === 'usuario')
      assert.lengthOf(alMod, 1)
      assert.equal(alMod[0].mensaje.mensaje, 'Gracias, quedo atento.')
      const alAdmin = (recibidos['admin/ticket:mensaje'] || []).filter((d) => d.mensaje.rolAutor === 'usuario')
      assert.lengthOf(alAdmin, 1)
      assert.lengthOf(recibidos['modCali/ticket:mensaje'] || [], 0)

      // Cambio de estado: el usuario recibe ticket:estado.
      const resuelto = await client
        .put(`/api/moderator/tickets/${ticketId}/status`)
        .bearerToken(modPopayan.token)
        .json({ estado: 'resuelto' })
      resuelto.assertStatus(200)
      await esperar(400)
      const estados = (recibidos['cliente/ticket:estado'] || []).map((d) => d.estado)
      assert.include(estados, 'resuelto')
    } finally {
      Object.values(sockets).forEach((s) => s.disconnect())
      await TicketSoporte.query().where('usuario_id', cliente.id).delete()
    }
  }).timeout(15000)
})
