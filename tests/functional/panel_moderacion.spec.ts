import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import testUtils from '@adonisjs/core/services/test_utils'
import env from '#start/env'
import AlertaEmergencia from '#models/alerta_emergencia'
import Conductor from '#models/conductor'
import ConfiguracionPlataforma from '#models/configuracion_plataforma'
import Disputa from '#models/disputa'
import Notificacion from '#models/notificacion'
import User from '#models/user'
import Viaje from '#models/viaje'
import ViajeRecorrido from '#models/viaje_recorrido'
import { guardarPuntoRecorrido } from '#services/viaje_recorrido_service'

/**
 * Panel de moderación (2026-10-09):
 *  - notificarConductor: bandeja siempre, push y correo (Brevo simulado) best-effort;
 *  - recorrido real del viaje: puntos cada ≥15 s o ≥30 m, endpoint admin y moderador de la zona;
 *  - ubicación solo de conductores conectados (admin drivers, ?online=, ?zona=);
 *  - inactividadDias en la config; lista de documentos requeridos.
 */

const uniq = () => `${Date.now()}${Math.floor(Math.random() * 1e6)}`

async function crearUsuario(client: any, datos: Record<string, unknown>) {
  const user = await User.create({
    nombre: 'Panel',
    apellido: 'Prueba',
    email: `panel_${uniq()}@test.com`,
    password: 'Password123',
    rol: 'cliente',
    ...datos,
  } as any)
  const login = await client.post('/api/auth/login').json({ email: user.email, password: 'Password123' })
  login.assertStatus(200)
  return { user, token: login.body().token as string }
}

async function crearConductor(client: any, ciudad: string, extra: Record<string, unknown> = {}) {
  const { user, token } = await crearUsuario(client, { rol: 'conductor', nombre: 'Pedro', apellido: 'Pérez' })
  const conductor = await Conductor.create({
    usuarioId: user.id,
    cedula: `${uniq()}`.slice(-10),
    placa: `PNL${`${uniq()}`.slice(-3)}`,
    tipoVehiculo: 'camioneta',
    capacidad: '1 tonelada',
    ciudad,
    estadoVerificacion: 'aprobado',
    ...extra,
  } as any)
  return { user, token, conductor }
}

const crearViaje = (clienteId: number, conductorId: number | null, extra: Record<string, unknown> = {}) =>
  Viaje.create({
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

const ubicado = { online: true, ultimaUbicacionLat: 2.44, ultimaUbicacionLng: -76.6, ubicacionActualizadaEn: DateTime.now() }

/** Simula Brevo como en recuperar_password.spec.ts: captura el cuerpo y responde 201. */
function simularBrevo() {
  const envios: any[] = []
  const original = globalThis.fetch
  const apiKeyAntes = env.get('BREVO_API_KEY')
  env.set('BREVO_API_KEY', 'test-key')
  globalThis.fetch = (async (_url: any, init: any) => {
    envios.push(JSON.parse(init.body))
    return new Response('{"messageId":"x"}', { status: 201 })
  }) as typeof fetch
  return {
    envios,
    restaurar: () => {
      globalThis.fetch = original
      env.set('BREVO_API_KEY', apiKeyAntes as any)
    },
  }
}

test.group('Panel: notificar al conductor por bandeja, push y correo', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('Notificar documentos deja bandeja + correo (Brevo simulado) y reporta los canales; sin FCM el push es false', async ({ client, assert }) => {
    const brevo = simularBrevo()
    try {
      const mod = await crearUsuario(client, { rol: 'moderador', esModerador: true, zonaModerador: 'popayan' })
      const driver = await crearConductor(client, 'Popayán', { estadoVerificacion: 'pendiente' })

      const res = await client
        .post(`/api/moderator/drivers/${driver.conductor.id}/notify`)
        .bearerToken(mod.token)
        .json({ documentos: ['licencia', 'soat'], mensaje: 'Súbelos hoy' })
      res.assertStatus(200)
      assert.deepEqual(res.body().canales, { bandeja: true, push: false, correo: true })
      assert.isFalse(res.body().push)

      const aviso = await Notificacion.query().where('usuario_id', driver.user.id).orderBy('id', 'desc').first()
      assert.equal(aviso?.tipo, 'documentos_faltantes')
      assert.include(aviso?.mensaje, 'Licencia, SOAT')
      assert.include(aviso?.mensaje, 'Nota del moderador: Súbelos hoy')

      assert.lengthOf(brevo.envios, 1)
      assert.equal(brevo.envios[0].to[0].email, driver.user.email)
      assert.include(brevo.envios[0].subject, 'Faltan documentos')
      assert.include(brevo.envios[0].htmlContent, 'CargaExpress')
      assert.include(brevo.envios[0].htmlContent, 'Hola Pedro')
    } finally {
      brevo.restaurar()
    }
  })

  test('sin BREVO_API_KEY el correo queda en false pero la bandeja siempre se crea', async ({ client, assert }) => {
    const apiKeyAntes = env.get('BREVO_API_KEY')
    env.set('BREVO_API_KEY', '' as any)
    try {
      const mod = await crearUsuario(client, { rol: 'moderador', esModerador: true, zonaModerador: 'popayan' })
      const driver = await crearConductor(client, 'Popayán')
      const res = await client.post(`/api/moderator/drivers/${driver.conductor.id}/notify`).bearerToken(mod.token).json({})
      res.assertStatus(200)
      assert.deepEqual(res.body().canales, { bandeja: true, push: false, correo: false })
      const aviso = await Notificacion.query().where('usuario_id', driver.user.id).first()
      assert.equal(aviso?.tipo, 'recordatorio_actividad')
    } finally {
      env.set('BREVO_API_KEY', apiKeyAntes as any)
    }
  })
})

test.group('Panel: recorrido real del viaje', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('se guarda un punto solo si pasaron 15 s o se movió 30 m', async ({ client, assert }) => {
    const cliente = await crearUsuario(client, { rol: 'cliente' })
    const driver = await crearConductor(client, 'Popayán')
    const viaje = await crearViaje(cliente.user.id, driver.conductor.id)

    assert.isNotNull(await guardarPuntoRecorrido(viaje.id, 2.4419, -76.6063))
    // 5 m más allá, en seguida: se descarta.
    assert.isNull(await guardarPuntoRecorrido(viaje.id, 2.44195, -76.6063))
    // ~110 m más allá: se guarda aunque no pasaran 15 s.
    assert.isNotNull(await guardarPuntoRecorrido(viaje.id, 2.4429, -76.6063))
    // Mismo sitio, pero el último punto es de hace 20 s: se guarda.
    await ViajeRecorrido.query().where('viaje_id', viaje.id).update({ created_at: DateTime.now().minus({ seconds: 20 }).toSQL() })
    assert.isNotNull(await guardarPuntoRecorrido(viaje.id, 2.4429, -76.6063))
    assert.equal(await ViajeRecorrido.query().where('viaje_id', viaje.id).count('* as n').then((r) => Number((r[0] as any).$extras.n)), 3)
  })

  test('PUT /drivers/location alimenta el recorrido del viaje activo', async ({ client, assert }) => {
    const cliente = await crearUsuario(client, { rol: 'cliente' })
    const driver = await crearConductor(client, 'Popayán', { online: true })
    const viaje = await crearViaje(cliente.user.id, driver.conductor.id)

    const res = await client.put('/api/drivers/location').bearerToken(driver.token).json({ lat: 2.4419, lng: -76.6063 })
    res.assertStatus(200)
    const puntos = await ViajeRecorrido.query().where('viaje_id', viaje.id)
    assert.lengthOf(puntos, 1)
    assert.closeTo(puntos[0].lat, 2.4419, 0.0001)
  })

  test('el admin y el moderador de la zona reciben planeada, recorrido y último punto; otra zona 404', async ({ client, assert }) => {
    const admin = await crearUsuario(client, { rol: 'admin' })
    const mod = await crearUsuario(client, { rol: 'moderador', esModerador: true, zonaModerador: 'popayan' })
    const modCali = await crearUsuario(client, { rol: 'moderador', esModerador: true, zonaModerador: 'cali' })
    const cliente = await crearUsuario(client, { rol: 'cliente' })
    const driver = await crearConductor(client, 'Popayán', ubicado)
    const viaje = await crearViaje(cliente.user.id, driver.conductor.id)
    await ViajeRecorrido.create({ viajeId: viaje.id, lat: 2.4419, lng: -76.6063 })
    await ViajeRecorrido.create({ viajeId: viaje.id, lat: 2.445, lng: -76.6 })

    const deAdmin = await client.get(`/api/admin/trips/${viaje.id}/recorrido`).bearerToken(admin.token)
    deAdmin.assertStatus(200)
    const b = deAdmin.body()
    assert.equal(b.viajeId, viaje.id)
    assert.isTrue(b.activo)
    assert.closeTo(b.origen.lat, 2.4419, 0.0001)
    assert.closeTo(b.destino.lng, -76.5952, 0.0001)
    assert.lengthOf(b.recorrido, 2)
    assert.closeTo(b.ultimoPunto.lat, 2.445, 0.0001)
    assert.isString(b.ultimoPunto.at)
    assert.closeTo(b.conductorUbicacion.lat, 2.44, 0.0001)
    assert.property(b, 'planeada') // null sin token de Mapbox en tests

    const deMod = await client.get(`/api/moderator/trips/${viaje.id}/recorrido`).bearerToken(mod.token)
    deMod.assertStatus(200)
    assert.lengthOf(deMod.body().recorrido, 2)

    const ajeno = await client.get(`/api/moderator/trips/${viaje.id}/recorrido`).bearerToken(modCali.token)
    ajeno.assertStatus(404)

    // Viaje cerrado y conductor apagado: sigue el recorrido, pero sin ubicación en vivo.
    viaje.estado = 'finalizado'
    await viaje.save()
    const cerrado = await client.get(`/api/admin/trips/${viaje.id}/recorrido`).bearerToken(admin.token)
    assert.isFalse(cerrado.body().activo)
    assert.isNull(cerrado.body().conductorUbicacion)
  })
})

test.group('Panel: zona y ubicación en el admin', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('drivers: ?zona= y ?online=1 filtran; solo el conectado entrega ultimaUbicacion; X-Total-Count', async ({ client, assert }) => {
    const admin = await crearUsuario(client, { rol: 'admin' })
    const conectado = await crearConductor(client, 'Popayán', ubicado)
    const apagado = await crearConductor(client, 'Popayán', { ...ubicado, online: false })
    const cali = await crearConductor(client, 'Cali', ubicado)

    const zona = await client.get('/api/admin/drivers?zona=popayan&limit=100').bearerToken(admin.token)
    zona.assertStatus(200)
    const ids = zona.body().map((d: any) => d.id)
    assert.includeMembers(ids, [conectado.conductor.id, apagado.conductor.id])
    assert.notInclude(ids, cali.conductor.id)
    assert.isAtLeast(Number(zona.header('x-total-count')), 2) // la base de pruebas puede traer más conductores de Popayán
    const filaOn = zona.body().find((d: any) => d.id === conectado.conductor.id)
    const filaOff = zona.body().find((d: any) => d.id === apagado.conductor.id)
    assert.closeTo(filaOn.ultimaUbicacion.lat, 2.44, 0.0001)
    assert.isString(filaOn.ultimaUbicacion.actualizadaEn)
    assert.isNull(filaOff.ultimaUbicacion)

    const online = await client.get('/api/admin/drivers?online=1&limit=100').bearerToken(admin.token)
    const idsOn = online.body().map((d: any) => d.id)
    assert.includeMembers(idsOn, [conectado.conductor.id, cali.conductor.id])
    assert.notInclude(idsOn, apagado.conductor.id)
  })

  test('drivers ?search= y ?estado=; users ?zona=; contactable-users ?rol=', async ({ client, assert }) => {
    const admin = await crearUsuario(client, { rol: 'admin' })
    const buscado = await crearConductor(client, 'Popayán', { estadoVerificacion: 'pendiente' })
    const otro = await crearConductor(client, 'Popayán')
    const modZona = await crearUsuario(client, { rol: 'cliente', esModerador: true, zonaModerador: 'popayan' })
    const modOtra = await crearUsuario(client, { rol: 'cliente', esModerador: true, zonaModerador: 'cali' })

    const porPlaca = await client.get(`/api/admin/drivers?search=${buscado.conductor.placa}`).bearerToken(admin.token)
    porPlaca.assertStatus(200)
    assert.deepEqual(porPlaca.body().map((d: any) => d.id), [buscado.conductor.id])

    const porEstado = await client.get('/api/admin/drivers?estado=pendiente&limit=100').bearerToken(admin.token)
    const idsPend = porEstado.body().map((d: any) => d.id)
    assert.include(idsPend, buscado.conductor.id)
    assert.notInclude(idsPend, otro.conductor.id)

    const users = await client.get('/api/admin/users?zona=popayan&limit=100').bearerToken(admin.token)
    users.assertStatus(200)
    const idsU = users.body().map((u: any) => u.id)
    assert.includeMembers(idsU, [modZona.user.id, buscado.user.id])
    assert.notInclude(idsU, modOtra.user.id)

    const contactables = await client.get('/api/moderator/contactable-users?rol=moderador&limit=100').bearerToken(admin.token)
    contactables.assertStatus(200)
    const filas = contactables.body().data ?? contactables.body()
    assert.isTrue(filas.every((u: any) => Boolean(u.esModerador)))
    assert.include(filas.map((u: any) => u.id), modZona.user.id)
  })

  test('trips, emergencies, disputes y pending-verifications aceptan ?zona=', async ({ client, assert }) => {
    const admin = await crearUsuario(client, { rol: 'admin' })
    const cliente = await crearUsuario(client, { rol: 'cliente' })
    const pop = await crearConductor(client, 'Popayán', { estadoVerificacion: 'pendiente' })
    const cali = await crearConductor(client, 'Cali', { estadoVerificacion: 'pendiente' })
    const vPop = await crearViaje(cliente.user.id, pop.conductor.id)
    const vCali = await crearViaje(cliente.user.id, cali.conductor.id)
    const sosPop = await AlertaEmergencia.create({ userId: pop.user.id, viajeId: vPop.id, lat: 2.44, lng: -76.6, motivo: 'x', estado: 'pendiente', atendida: false } as any)
    const sosCali = await AlertaEmergencia.create({ userId: cali.user.id, viajeId: vCali.id, lat: 3.4, lng: -76.5, motivo: 'x', estado: 'pendiente', atendida: false } as any)
    const dPop = await Disputa.create({ viajeId: vPop.id, conductorId: pop.conductor.id, clienteId: cliente.user.id, estado: 'abierta', versionConductor: 'a' } as any)
    const dCali = await Disputa.create({ viajeId: vCali.id, conductorId: cali.conductor.id, clienteId: cliente.user.id, estado: 'abierta', versionConductor: 'b' } as any)

    const idsDe = (body: any) => body.map((x: any) => Number(x.id))
    const trips = await client.get('/api/admin/trips?zona=popayan&limit=100').bearerToken(admin.token)
    trips.assertStatus(200)
    assert.include(idsDe(trips.body()), vPop.id)
    assert.notInclude(idsDe(trips.body()), vCali.id)

    const enCurso = await client.get('/api/admin/trips?estado=cancelado&limit=100').bearerToken(admin.token)
    assert.notInclude(idsDe(enCurso.body()), vPop.id)

    const sos = await client.get('/api/admin/emergencies?zona=popayan&limit=100').bearerToken(admin.token)
    sos.assertStatus(200)
    assert.include(idsDe(sos.body()), sosPop.id)
    assert.notInclude(idsDe(sos.body()), sosCali.id)

    const disputas = await client.get('/api/admin/disputes?zona=popayan&limit=100').bearerToken(admin.token)
    disputas.assertStatus(200)
    assert.include(idsDe(disputas.body()), dPop.id)
    assert.notInclude(idsDe(disputas.body()), dCali.id)

    const pend = await client.get('/api/admin/verifications?zona=popayan&limit=100').bearerToken(admin.token)
    pend.assertStatus(200)
    assert.include(idsDe(pend.body()), pop.conductor.id)
    assert.notInclude(idsDe(pend.body()), cali.conductor.id)
  })
})

test.group('Panel: configuración y documentos requeridos', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('inactividadDias se lee (7 por defecto), se guarda y se valida; los inactivos del moderador la usan', async ({ client, assert }) => {
    const admin = await crearUsuario(client, { rol: 'admin' })
    const antes = await client.get('/api/admin/config').bearerToken(admin.token)
    antes.assertStatus(200)
    assert.equal(antes.body().inactividadDias, 7)

    const malo = await client.put('/api/admin/config').bearerToken(admin.token).json({ inactividadDias: 0 })
    malo.assertStatus(422)
    const bueno = await client.put('/api/admin/config').bearerToken(admin.token).json({ inactividadDias: 30 })
    bueno.assertStatus(200)
    assert.equal(bueno.body().inactividadDias, 30)
    assert.equal((await ConfiguracionPlataforma.unica())?.inactividadDias, 30)

    // Un conductor sin viajes desde hace 10 días ya no es inactivo con el límite en 30.
    const mod = await crearUsuario(client, { rol: 'moderador', esModerador: true, zonaModerador: 'popayan' })
    const driver = await crearConductor(client, 'Popayán')
    await Conductor.query().where('id', driver.conductor.id).update({ created_at: DateTime.now().minus({ days: 10 }).toSQL() })
    const inactivos = await client.get('/api/moderator/drivers/inactive?limit=100').bearerToken(mod.token)
    inactivos.assertStatus(200)
    assert.equal(inactivos.body().inactividadDias, 30)
    assert.notInclude(inactivos.body().data.map((d: any) => d.id), driver.conductor.id)
  })

  test('GET /api/config/documentos-conductor devuelve clave y etiqueta de cada documento', async ({ client, assert }) => {
    const mod = await crearUsuario(client, { rol: 'moderador', esModerador: true, zonaModerador: 'popayan' })
    const res = await client.get('/api/config/documentos-conductor').bearerToken(mod.token)
    res.assertStatus(200)
    const claves = res.body().map((d: any) => d.clave)
    assert.includeMembers(claves, ['licencia', 'soat', 'tecnomecanica', 'tarjeta_propiedad', 'foto_vehiculo', 'foto_conductor', 'numero_cedula'])
    assert.equal(res.body().find((d: any) => d.clave === 'soat').etiqueta, 'SOAT')
  })
})

test.group('Panel: perfil del cliente', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('admin completo; moderador reducido sin caso y completo con disputa en su zona', async ({ client, assert }) => {
    const admin = await crearUsuario(client, { rol: 'admin' })
    const mod = await crearUsuario(client, { rol: 'moderador', esModerador: true, zonaModerador: 'popayan' })
    const cliente = await crearUsuario(client, { rol: 'cliente', nombre: 'Laura', apellido: 'Gómez', avatar: '/storage/uploads/laura.png' })
    const pop = await crearConductor(client, 'Popayán')
    const viaje = await crearViaje(cliente.user.id, pop.conductor.id, { estado: 'finalizado', precioFinal: 50000 })

    const full = await client.get(`/api/moderator/clients/${cliente.user.id}`).bearerToken(admin.token)
    full.assertStatus(200)
    assert.isTrue(full.body().completo)
    assert.equal(full.body().email, cliente.user.email)
    assert.equal(full.body().totalViajes, 1)
    assert.equal(full.body().viajes[0].id, viaje.id)

    const reducido = await client.get(`/api/moderator/clients/${cliente.user.id}`).bearerToken(mod.token)
    reducido.assertStatus(200)
    assert.isFalse(reducido.body().completo)
    assert.equal(reducido.body().nombre, 'Laura G.')
    assert.equal(reducido.body().avatar, '/storage/uploads/laura.png')
    assert.isUndefined(reducido.body().email)

    await Disputa.create({ viajeId: viaje.id, conductorId: pop.conductor.id, clienteId: cliente.user.id, estado: 'abierta', versionConductor: 'a' } as any)
    const conCaso = await client.get(`/api/moderator/clients/${cliente.user.id}`).bearerToken(mod.token)
    conCaso.assertStatus(200)
    assert.isTrue(conCaso.body().completo)
    assert.equal(conCaso.body().disputas.length, 1)

    const noExiste = await client.get('/api/moderator/clients/999999999').bearerToken(admin.token)
    noExiste.assertStatus(404)
  })
})
