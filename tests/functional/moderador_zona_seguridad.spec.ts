import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import AlertaEmergencia from '#models/alerta_emergencia'
import Aviso from '#models/aviso'
import Conductor from '#models/conductor'
import Conversacion from '#models/conversacion'
import Disputa from '#models/disputa'
import TicketSoporte from '#models/ticket_soporte'
import User from '#models/user'
import Viaje from '#models/viaje'

/**
 * Seguridad por zona del panel de moderador:
 *  - `conductores.ciudad` es texto libre ('Popayán', 'POPAYAN') y la zona del
 *    moderador una clave normalizada ('popayan'): deben coincidir.
 *  - El moderador nunca cambia su zona con ?ciudad; el admin sí puede filtrar.
 *  - Atender/resolver emergencias exige ser de la zona (o admin).
 *  - Avisos y conversaciones quedan acotados a la zona / a los participantes.
 */

const uniq = () => `${Date.now()}${Math.floor(Math.random() * 1e6)}`

async function login(client: any, email: string) {
  const res = await client.post('/api/auth/login').json({ email, password: 'Password123' })
  res.assertStatus(200)
  return res.body().token as string
}

async function crearUsuario(client: any, datos: Record<string, unknown>) {
  const user = await User.create({
    nombre: 'Test',
    apellido: 'Zona',
    email: `zona_${uniq()}@test.com`,
    password: 'Password123',
    rol: 'cliente',
    ...datos,
  } as any)
  return { user, token: await login(client, user.email) }
}

const crearModerador = (client: any, zona: string | null) =>
  crearUsuario(client, { rol: 'moderador', esModerador: true, zonaModerador: zona })

const crearAdmin = (client: any) => crearUsuario(client, { rol: 'admin' })

async function crearConductor(client: any, ciudad: string) {
  const { user, token } = await crearUsuario(client, { rol: 'conductor' })
  const conductor = await Conductor.create({
    usuarioId: user.id,
    cedula: `${uniq()}`.slice(-10),
    placa: `ZON${`${uniq()}`.slice(-3)}`,
    tipoVehiculo: 'camioneta',
    capacidad: '1 tonelada',
    ciudad,
    estadoVerificacion: 'aprobado',
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

/** Escenario base: conductor con ciudad 'Popayán' (con tilde y mayúscula) y un viaje suyo. */
async function escenario(client: any, ciudad = 'Popayán') {
  const cliente = await crearUsuario(client, { rol: 'cliente' })
  const driver = await crearConductor(client, ciudad)
  const viaje = await crearViaje(cliente.user.id, driver.conductor.id)
  return { cliente, driver, viaje }
}

function items(body: any): any[] {
  if (Array.isArray(body)) return body
  if (Array.isArray(body?.data)) return body.data
  return []
}

const ids = (body: any) => items(body).map((x: any) => Number(x.id))

test.group('Moderador: zona normalizada en viajes y emergencias', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('un viaje de conductor "Popayán" es visible para el moderador de zona "popayan"', async ({ client, assert }) => {
    const { viaje } = await escenario(client)
    const mod = await crearModerador(client, 'popayan')

    const lista = await client.get('/api/moderator/trips?limit=100').bearerToken(mod.token)
    lista.assertStatus(200)
    assert.include(ids(lista.body()), Number(viaje.id))

    const detalle = await client.get(`/api/moderator/trips/${viaje.id}`).bearerToken(mod.token)
    detalle.assertStatus(200)
  })

  test('ciudad "POPAYAN" en mayúsculas también cuenta como la zona', async ({ client, assert }) => {
    const { viaje } = await escenario(client, 'POPAYAN ')
    const mod = await crearModerador(client, 'popayan')
    const lista = await client.get('/api/moderator/trips?limit=100').bearerToken(mod.token)
    lista.assertStatus(200)
    assert.include(ids(lista.body()), Number(viaje.id))
  })

  test('la emergencia de un conductor "Popayán" aparece en la lista y el conteo del moderador', async ({ client, assert }) => {
    const { driver, viaje } = await escenario(client)
    const mod = await crearModerador(client, 'popayan')
    const alerta = await AlertaEmergencia.create({
      userId: driver.user.id,
      viajeId: viaje.id,
      lat: 2.448,
      lng: -76.6,
      motivo: 'Prueba',
      estado: 'pendiente',
      atendida: false,
    } as any)

    const lista = await client.get('/api/moderator/emergency?limit=100').bearerToken(mod.token)
    lista.assertStatus(200)
    assert.include(ids(lista.body()), Number(alerta.id))
    const item = items(lista.body()).find((a: any) => Number(a.id) === Number(alerta.id))
    assert.property(item, 'atendidoPor')
    assert.property(item, 'administrador')

    const conteo = await client.get('/api/moderator/emergency/count').bearerToken(mod.token)
    conteo.assertStatus(200)
    assert.isAtLeast(conteo.body().pendientes, 1)
  })

  test('el moderador de otra zona no ve el viaje ni la emergencia', async ({ client, assert }) => {
    const { driver, viaje } = await escenario(client)
    const alerta = await AlertaEmergencia.create({
      userId: driver.user.id,
      viajeId: viaje.id,
      motivo: 'Prueba',
      estado: 'pendiente',
      atendida: false,
    } as any)
    const otro = await crearModerador(client, 'cali')

    const lista = await client.get('/api/moderator/trips?limit=100').bearerToken(otro.token)
    lista.assertStatus(200)
    assert.notInclude(ids(lista.body()), Number(viaje.id))

    const detalle = await client.get(`/api/moderator/trips/${viaje.id}`).bearerToken(otro.token)
    detalle.assertStatus(404)

    const sos = await client.get('/api/moderator/emergency?limit=100').bearerToken(otro.token)
    sos.assertStatus(200)
    assert.notInclude(ids(sos.body()), Number(alerta.id))
  })
})

test.group('Moderador: ?ciudad solo aplica al admin', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('el moderador no puede cambiar su zona con ?ciudad', async ({ client, assert }) => {
    const { viaje, driver } = await escenario(client)
    const alerta = await AlertaEmergencia.create({
      userId: driver.user.id,
      viajeId: viaje.id,
      motivo: 'Prueba',
      estado: 'pendiente',
      atendida: false,
    } as any)
    const otro = await crearModerador(client, 'cali')

    const lista = await client.get('/api/moderator/trips?limit=100&ciudad=popayan').bearerToken(otro.token)
    lista.assertStatus(200)
    assert.notInclude(ids(lista.body()), Number(viaje.id))

    const detalle = await client.get(`/api/moderator/trips/${viaje.id}?ciudad=popayan`).bearerToken(otro.token)
    detalle.assertStatus(404)

    const sos = await client.get('/api/moderator/emergency?limit=100&ciudad=popayan').bearerToken(otro.token)
    sos.assertStatus(200)
    assert.notInclude(ids(sos.body()), Number(alerta.id))
  })

  test('el admin sin zona puede consultar con y sin ?ciudad', async ({ client, assert }) => {
    const { viaje, driver } = await escenario(client)
    const alerta = await AlertaEmergencia.create({
      userId: driver.user.id,
      viajeId: viaje.id,
      motivo: 'Prueba',
      estado: 'pendiente',
      atendida: false,
    } as any)
    const admin = await crearAdmin(client)

    const conCiudad = await client.get('/api/moderator/trips?limit=100&ciudad=Popayán').bearerToken(admin.token)
    conCiudad.assertStatus(200)
    assert.include(ids(conCiudad.body()), Number(viaje.id))

    const otraCiudad = await client.get('/api/moderator/trips?limit=100&ciudad=cali').bearerToken(admin.token)
    otraCiudad.assertStatus(200)
    assert.notInclude(ids(otraCiudad.body()), Number(viaje.id))

    const sinCiudad = await client.get('/api/moderator/trips?limit=100').bearerToken(admin.token)
    sinCiudad.assertStatus(200)
    assert.include(ids(sinCiudad.body()), Number(viaje.id))

    const detalle = await client.get(`/api/moderator/trips/${viaje.id}`).bearerToken(admin.token)
    detalle.assertStatus(200)

    const sos = await client.get('/api/moderator/emergency?limit=100&ciudad=popayan').bearerToken(admin.token)
    sos.assertStatus(200)
    assert.include(ids(sos.body()), Number(alerta.id))

    const conteo = await client.get('/api/moderator/emergency/count?ciudad=popayan').bearerToken(admin.token)
    conteo.assertStatus(200)

    const reservas = await client.get('/api/moderator/reservations?ciudad=popayan').bearerToken(admin.token)
    reservas.assertStatus(200)
  })

  test('reservas: el filtro de zona se aplica antes de paginar y el total es correcto', async ({ client, assert }) => {
    const cliente = await crearUsuario(client, { rol: 'cliente' })
    const enZona = await crearConductor(client, 'Popayán')
    const fuera = await crearConductor(client, 'Cali')
    const mod = await crearModerador(client, 'popayan')

    const base = { tipoProgramacion: 'programada', estado: 'reservado', horaProgramada: '08:00' }
    // Muchas reservas de otra ciudad, programadas antes: con el viejo .limit(200)
    // desplazaban a las de la zona.
    for (let i = 0; i < 5; i++) {
      await crearViaje(cliente.user.id, fuera.conductor.id, { ...base, fechaProgramada: '2030-01-01' })
    }
    const propias = []
    for (let i = 0; i < 3; i++) {
      propias.push(await crearViaje(cliente.user.id, enZona.conductor.id, { ...base, fechaProgramada: '2030-02-01' }))
    }

    const res = await client.get('/api/moderator/reservations?limit=2&page=2').bearerToken(mod.token)
    res.assertStatus(200)
    assert.equal(res.body().total, 3)
    assert.lengthOf(res.body().data, 1)
    const todas = await client.get('/api/moderator/reservations?limit=100').bearerToken(mod.token)
    assert.sameMembers(
      ids(todas.body()),
      propias.map((v) => Number(v.id))
    )
  })
})

test.group('Moderador: atender y resolver emergencias por zona', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('un moderador de otra zona recibe 403 al atender o resolver', async ({ client }) => {
    const { driver, viaje } = await escenario(client)
    const alerta = await AlertaEmergencia.create({
      userId: driver.user.id,
      viajeId: viaje.id,
      motivo: 'Prueba',
      estado: 'pendiente',
      atendida: false,
    } as any)
    const otro = await crearModerador(client, 'cali')

    const ack = await client.post(`/api/moderator/emergency/${alerta.id}/acknowledge`).bearerToken(otro.token)
    ack.assertStatus(403)
    const res = await client.post(`/api/moderator/emergency/${alerta.id}/resolve`).bearerToken(otro.token)
    res.assertStatus(403)
  })

  test('si la zona de la alerta no se puede resolver, el moderador recibe 403 y el admin puede actuar', async ({ client, assert }) => {
    const cliente = await crearUsuario(client, { rol: 'cliente' })
    // Sin viaje ni coordenadas: no hay forma de saber la zona.
    const alerta = await AlertaEmergencia.create({
      userId: cliente.user.id,
      viajeId: null,
      lat: null,
      lng: null,
      motivo: 'Sin zona',
      estado: 'pendiente',
      atendida: false,
    } as any)
    const mod = await crearModerador(client, 'popayan')
    const admin = await crearAdmin(client)

    const ack = await client.post(`/api/moderator/emergency/${alerta.id}/acknowledge`).bearerToken(mod.token)
    ack.assertStatus(403)
    const resMod = await client.post(`/api/moderator/emergency/${alerta.id}/resolve`).bearerToken(mod.token)
    resMod.assertStatus(403)

    const resAdmin = await client.post(`/api/moderator/emergency/${alerta.id}/resolve`).bearerToken(admin.token)
    resAdmin.assertStatus(200)
    assert.equal(resAdmin.body().estado, 'resuelta')
  })

  test('resolver informa como atendidoPor al moderador que atendió, no a quien resuelve', async ({ client, assert }) => {
    const { driver, viaje } = await escenario(client)
    const alerta = await AlertaEmergencia.create({
      userId: driver.user.id,
      viajeId: viaje.id,
      motivo: 'Prueba',
      estado: 'pendiente',
      atendida: false,
    } as any)
    const mod1 = await crearUsuario(client, {
      nombre: 'Ana',
      apellido: 'Atiende',
      rol: 'moderador',
      esModerador: true,
      zonaModerador: 'popayan',
    })
    const mod2 = await crearUsuario(client, {
      nombre: 'Rosa',
      apellido: 'Resuelve',
      rol: 'moderador',
      esModerador: true,
      zonaModerador: 'Popayán',
    })

    const ack = await client.post(`/api/moderator/emergency/${alerta.id}/acknowledge`).bearerToken(mod1.token)
    ack.assertStatus(200)
    assert.equal(ack.body().atendidoPor, 'Ana Atiende')

    const res = await client.post(`/api/moderator/emergency/${alerta.id}/resolve`).bearerToken(mod2.token)
    res.assertStatus(200)
    assert.equal(res.body().atendidoPor, 'Ana Atiende')
    assert.equal(res.body().resueltoPor, 'Rosa Resuelve')
  })
})

test.group('Avisos por zona', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('el aviso de un moderador queda en su zona; el admin publica en general o en ?ciudad', async ({ client, assert }) => {
    const mod = await crearModerador(client, 'popayan')
    const admin = await crearAdmin(client)

    const m = await client.post('/api/avisos').bearerToken(mod.token).json({ contenido: 'aviso de zona', ciudad: 'cali' })
    m.assertStatus(200)
    assert.equal(m.body().zona, 'popayan')

    const g = await client.post('/api/avisos').bearerToken(admin.token).json({ contenido: 'aviso general' })
    g.assertStatus(200)
    assert.equal(g.body().zona, 'general')

    const c = await client.post('/api/avisos').bearerToken(admin.token).json({ contenido: 'aviso cali', ciudad: 'Cali' })
    c.assertStatus(200)
    assert.equal(c.body().zona, 'cali')
  })

  test('el listado muestra la zona propia más general (moderador y conductor)', async ({ client, assert }) => {
    const autor = await crearAdmin(client)
    const general = await Aviso.create({ autorId: autor.user.id, zona: 'general', contenido: 'g' })
    const popayan = await Aviso.create({ autorId: autor.user.id, zona: 'popayan', contenido: 'p' })
    const cali = await Aviso.create({ autorId: autor.user.id, zona: 'cali', contenido: 'c' })

    const mod = await crearModerador(client, 'popayan')
    const lm = await client.get('/api/avisos?limit=100').bearerToken(mod.token)
    lm.assertStatus(200)
    assert.includeMembers(ids(lm.body()), [general.id, popayan.id])
    assert.notInclude(ids(lm.body()), cali.id)

    const driver = await crearConductor(client, 'Popayán')
    const lc = await client.get('/api/avisos?limit=100').bearerToken(driver.token)
    lc.assertStatus(200)
    assert.includeMembers(ids(lc.body()), [general.id, popayan.id])
    assert.notInclude(ids(lc.body()), cali.id)

    const la = await client.get('/api/avisos?limit=100').bearerToken(autor.token)
    la.assertStatus(200)
    assert.includeMembers(ids(la.body()), [general.id, popayan.id, cali.id])
  })

  test('un moderador solo fija o elimina avisos de su zona', async ({ client, assert }) => {
    const autor = await crearAdmin(client)
    const propio = await Aviso.create({ autorId: autor.user.id, zona: 'popayan', contenido: 'p' })
    const ajeno = await Aviso.create({ autorId: autor.user.id, zona: 'cali', contenido: 'c' })
    const mod = await crearModerador(client, 'popayan')

    ;(await client.put(`/api/avisos/${ajeno.id}/pin`).bearerToken(mod.token)).assertStatus(403)
    ;(await client.delete(`/api/avisos/${ajeno.id}`).bearerToken(mod.token)).assertStatus(403)

    const pin = await client.put(`/api/avisos/${propio.id}/pin`).bearerToken(mod.token)
    pin.assertStatus(200)
    assert.isTrue(Boolean(pin.body().fijado))
    ;(await client.delete(`/api/avisos/${propio.id}`).bearerToken(mod.token)).assertStatus(200)
  })
})

test.group('Conversaciones del moderador', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('el moderador solo lista conversaciones donde participa (de cualquier lado)', async ({ client, assert }) => {
    const mod = await crearModerador(client, 'popayan')
    const otroMod = await crearModerador(client, 'popayan')
    const admin = await crearAdmin(client)
    const cliente = await crearUsuario(client, { rol: 'cliente' })

    const propia = await Conversacion.create({ moderadorId: mod.user.id, usuarioId: cliente.user.id, ciudad: 'popayan' })
    const comoUsuario = await Conversacion.create({ moderadorId: admin.user.id, usuarioId: mod.user.id, ciudad: null })
    const ajena = await Conversacion.create({ moderadorId: otroMod.user.id, usuarioId: cliente.user.id, ciudad: 'popayan' })

    const res = await client.get('/api/moderator/conversations').bearerToken(mod.token)
    res.assertStatus(200)
    const lista = ids(res.body())
    assert.includeMembers(lista, [propia.id, comoUsuario.id])
    assert.notInclude(lista, ajena.id)
  })

  test('store ignora ?ciudad del moderador y usa su zona', async ({ client, assert }) => {
    const mod = await crearModerador(client, 'popayan')
    const driver = await crearConductor(client, 'Popayán')
    const res = await client
      .post('/api/moderator/conversations')
      .bearerToken(mod.token)
      .json({ usuarioId: driver.user.id, ciudad: 'cali' })
    res.assertStatus(200)
    assert.equal(res.body().ciudad, 'popayan')
  })

  test('unread-count cuenta también las conversaciones donde el moderador es el usuario', async ({ client, assert }) => {
    const mod = await crearModerador(client, 'popayan')
    const admin = await crearAdmin(client)
    const conv = await Conversacion.create({ moderadorId: admin.user.id, usuarioId: mod.user.id, ciudad: null })
    const env = await client
      .post(`/api/moderator/conversations/${conv.id}/messages`)
      .bearerToken(admin.token)
      .json({ mensaje: 'hola moderador' })
    env.assertStatus(200)

    const res = await client.get('/api/moderator/conversations/unread-count').bearerToken(mod.token)
    res.assertStatus(200)
    assert.equal(res.body().total, 1)
  })
})

test.group('Tickets: tomado por otro moderador', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('responder o cambiar estado de un ticket de otro moderador da 409; el admin puede', async ({ client }) => {
    const cliente = await crearUsuario(client, { rol: 'cliente' })
    const mod1 = await crearModerador(client, 'popayan')
    const mod2 = await crearModerador(client, 'popayan')
    const admin = await crearAdmin(client)
    const ticket = await TicketSoporte.create({
      usuarioId: cliente.user.id,
      categoria: 'otro',
      asunto: 'Ayuda',
      descripcion: 'Necesito ayuda con algo',
      estado: 'en_proceso',
      zona: 'popayan',
      moderadorId: mod1.user.id,
    } as any)

    const msg = await client
      .post(`/api/moderator/tickets/${ticket.id}/messages`)
      .bearerToken(mod2.token)
      .json({ mensaje: 'me meto' })
    msg.assertStatus(409)
    const estado = await client
      .put(`/api/moderator/tickets/${ticket.id}/status`)
      .bearerToken(mod2.token)
      .json({ estado: 'resuelto' })
    estado.assertStatus(409)

    const propio = await client
      .put(`/api/moderator/tickets/${ticket.id}/status`)
      .bearerToken(mod1.token)
      .json({ estado: 'resuelto' })
    propio.assertStatus(200)
    const deAdmin = await client
      .put(`/api/moderator/tickets/${ticket.id}/status`)
      .bearerToken(admin.token)
      .json({ estado: 'en_proceso' })
    deAdmin.assertStatus(200)
  })
})

test.group('Cierre pendiente derivado a disputa', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('no duplica la disputa si ya existe una abierta y un segundo intento da 409', async ({ client, assert }) => {
    const cliente = await crearUsuario(client, { rol: 'cliente' })
    const driver = await crearConductor(client, 'Popayán')
    const viaje = await crearViaje(cliente.user.id, driver.conductor.id, { estado: 'pendiente_confirmacion' })
    await Disputa.create({
      viajeId: viaje.id,
      conductorId: driver.conductor.id,
      clienteId: cliente.user.id,
      estado: 'abierta',
      versionConductor: 'previa',
    } as any)
    const mod = await crearModerador(client, 'popayan')
    const body = { resolucion: 'disputa', nota: 'El cliente no respondió el cierre a tiempo.' }

    const res = await client.post(`/api/moderator/trips/${viaje.id}/resolve-close`).bearerToken(mod.token).json(body)
    res.assertStatus(200)
    assert.equal(res.body().estado, 'disputa')
    const disputas = await Disputa.query().where('viaje_id', viaje.id)
    assert.lengthOf(disputas, 1)

    const otra = await client.post(`/api/moderator/trips/${viaje.id}/resolve-close`).bearerToken(mod.token).json(body)
    assert.oneOf(otra.status(), [409, 422])
    assert.lengthOf(await Disputa.query().where('viaje_id', viaje.id), 1)
  })
})
