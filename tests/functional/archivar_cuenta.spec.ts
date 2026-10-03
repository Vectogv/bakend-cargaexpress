import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'
import User from '#models/user'
import Conductor from '#models/conductor'
import Viaje from '#models/viaje'
import Disputa from '#models/disputa'
import ArchivadoCuentaService from '#services/archivado_cuenta_service'

/** DELETE /api/users/me archiva la cuenta (no borra nada) y las inactivas se archivan solas. */

const uniq = () => `${Date.now()}${Math.floor(Math.random() * 1e6)}`
const PASS = 'Password123'

async function registrar(client: any, rol: 'cliente' | 'conductor') {
  const email = `arch_${rol}_${uniq()}@test.com`
  const res = await client.post('/api/auth/register').json({
    nombre: 'Arch',
    apellido: rol,
    email,
    password: PASS,
    rol,
    edad: 30,
    ...(rol === 'conductor'
      ? {
          cedula: uniq().slice(-10),
          placa: `ARC${uniq().slice(-4)}`,
          tipoVehiculo: 'camioneta',
          capacidad: '1 tonelada',
          ciudad: 'popayan',
        }
      : {}),
  })
  res.assertStatus(200)
  const user = await User.findOrFail(Number(res.body().id))
  const conductor = rol === 'conductor' ? await Conductor.findByOrFail('usuario_id', user.id) : null
  return { user, conductor, email, token: res.body().token as string, refresh: res.body().refreshToken as string }
}

async function crearViaje(clienteId: number, conductorId: number | null, estado: string) {
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

test.group('Archivar cuenta: DELETE /api/users/me', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('sin token responde 401', async ({ client }) => {
    ;(await client.delete('/api/users/me')).assertStatus(401)
  })

  test('cliente limpio: queda archivado, sin tokens ni fcm, y no se borra nada', async ({ client, assert }) => {
    const c = await registrar(client, 'cliente')
    c.user.fcmToken = 'fcm-abc'
    await c.user.save()

    const res = await client.delete('/api/users/me').bearerToken(c.token)
    res.assertStatus(200)

    const u = await User.findOrFail(c.user.id)
    assert.equal(u.estadoCuenta, 'archivada')
    assert.isNotNull(u.archivadaAt)
    assert.isNull(u.fcmToken)
    assert.equal(u.email, c.email)
    const tokens = await db.from('auth_access_tokens').where('tokenable_id', u.id)
    assert.lengthOf(tokens, 0)
    const refrescos = await db.from('refresh_tokens').where('user_id', u.id)
    assert.lengthOf(refrescos, 0)
  })

  test('conductor limpio: queda archivado y desconectado', async ({ client, assert }) => {
    const c = await registrar(client, 'conductor')
    await db.from('conductores').where('id', c.conductor!.id).update({ online: true })

    ;(await client.delete('/api/users/me').bearerToken(c.token)).assertStatus(200)

    const u = await User.findOrFail(c.user.id)
    assert.equal(u.estadoCuenta, 'archivada')
    const cond = await Conductor.findOrFail(c.conductor!.id)
    assert.isFalse(Boolean(cond.online))
  })

  test('tras archivar: login, Google y refresh rechazan la cuenta', async ({ client, assert }) => {
    const c = await registrar(client, 'cliente')
    ;(await client.delete('/api/users/me').bearerToken(c.token)).assertStatus(200)

    const login = await client.post('/api/auth/login').json({ email: c.email, password: PASS })
    login.assertStatus(403)
    assert.equal(login.body().code, 'CUENTA_ARCHIVADA')

    const refresh = await client.post('/api/auth/refresh-token').json({ refreshToken: c.refresh })
    refresh.assertStatus(401)

    // El token de acceso ya no sirve.
    ;(await client.get('/api/users/profile').bearerToken(c.token)).assertStatus(401)
  })

  test('409 con viaje activo', async ({ client, assert }) => {
    const c = await registrar(client, 'cliente')
    await crearViaje(c.user.id, null, 'buscando_conductor')
    const res = await client.delete('/api/users/me').bearerToken(c.token)
    res.assertStatus(409)
    assert.include(res.body().message, 'viaje o una reserva en curso')
    assert.notEqual((await User.findOrFail(c.user.id)).estadoCuenta, 'archivada')
  })

  test('409 con viaje activo del lado del conductor', async ({ client }) => {
    const cli = await registrar(client, 'cliente')
    const con = await registrar(client, 'conductor')
    await crearViaje(cli.user.id, con.conductor!.id, 'en_curso')
    ;(await client.delete('/api/users/me').bearerToken(con.token)).assertStatus(409)
  })

  test('409 con reserva con conductor asignado; una reserva sin conductor no bloquea', async ({ client }) => {
    const cli = await registrar(client, 'cliente')
    const con = await registrar(client, 'conductor')
    await crearViaje(cli.user.id, con.conductor!.id, 'reservado')
    ;(await client.delete('/api/users/me').bearerToken(cli.token)).assertStatus(409)

    const cli2 = await registrar(client, 'cliente')
    await crearViaje(cli2.user.id, null, 'reservado')
    ;(await client.delete('/api/users/me').bearerToken(cli2.token)).assertStatus(200)
  })

  test('409 con disputa abierta', async ({ client, assert }) => {
    const cli = await registrar(client, 'cliente')
    const con = await registrar(client, 'conductor')
    const viaje = await crearViaje(cli.user.id, con.conductor!.id, 'finalizado')
    await Disputa.create({
      viajeId: viaje.id,
      conductorId: con.conductor!.id,
      clienteId: cli.user.id,
      versionConductor: 'x',
    } as any)
    const res = await client.delete('/api/users/me').bearerToken(cli.token)
    res.assertStatus(409)
    assert.include(res.body().message, 'disputa abierta')
  })

  test('409 con suspension_por_pago, con deuda de comisión y con comprobante en revisión', async ({ client, assert }) => {
    const a = await registrar(client, 'conductor')
    a.user.estadoCuenta = 'suspension_por_pago'
    await a.user.save()
    const ra = await client.delete('/api/users/me').bearerToken(a.token)
    ra.assertStatus(409)
    assert.include(ra.body().message, 'pago o una deuda pendiente')

    const b = await registrar(client, 'conductor')
    b.user.montoDeuda = 9000
    await b.user.save()
    ;(await client.delete('/api/users/me').bearerToken(b.token)).assertStatus(409)

    const c = await registrar(client, 'conductor')
    c.user.estadoCuenta = 'esperando_confirmacion'
    await c.user.save()
    ;(await client.delete('/api/users/me').bearerToken(c.token)).assertStatus(409)
  })
})

test.group('Archivar cuentas inactivas (6 meses)', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  async function envejecer(userId: number, meses: number) {
    const f = DateTime.now().minus({ months: meses }).toSQL({ includeOffset: false })!
    await db.from('users').where('id', userId).update({ updated_at: f, created_at: f })
    await db.from('auth_access_tokens').where('tokenable_id', userId).update({ created_at: f, updated_at: f })
    await db.from('refresh_tokens').where('user_id', userId).update({ created_at: f })
  }

  test('archiva la cuenta sin uso, deja la activa y la que tiene pendientes', async ({ client, assert }) => {
    const vieja = await registrar(client, 'cliente')
    const reciente = await registrar(client, 'cliente')
    const conDeuda = await registrar(client, 'conductor')
    conDeuda.user.montoDeuda = 9000
    await conDeuda.user.save()

    await envejecer(vieja.user.id, 7)
    await envejecer(conDeuda.user.id, 7)
    await db.from('users').where('id', conDeuda.user.id).update({ monto_deuda: 9000 })

    await ArchivadoCuentaService.archivarInactivas()

    assert.equal((await User.findOrFail(vieja.user.id)).estadoCuenta, 'archivada')
    assert.equal((await User.findOrFail(reciente.user.id)).estadoCuenta, 'activa')
    assert.equal((await User.findOrFail(conDeuda.user.id)).estadoCuenta, 'activa')
  })

  test('una cuenta vieja con un viaje reciente se considera en uso', async ({ client, assert }) => {
    const c = await registrar(client, 'cliente')
    await envejecer(c.user.id, 7)
    await crearViaje(c.user.id, null, 'cancelado')

    await ArchivadoCuentaService.archivarInactivas()

    assert.equal((await User.findOrFail(c.user.id)).estadoCuenta, 'activa')
  })
})
