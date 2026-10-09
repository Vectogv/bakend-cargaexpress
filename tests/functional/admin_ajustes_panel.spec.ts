import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import { DateTime } from 'luxon'
import AlertaEmergencia from '#models/alerta_emergencia'
import Conductor from '#models/conductor'
import Ganancia from '#models/ganancia'
import User from '#models/user'

/**
 * Ajustes del panel de admin:
 *  - /api/admin/drivers expone usuario.esLider (toggle de Líder).
 *  - Marcar comisiones pagadas descuenta la deuda del conductor.
 *  - /api/admin/emergencies acepta ?estado= y trae estado/motivo/atendidoPor.
 */

const uniq = () => `${Date.now()}${Math.floor(Math.random() * 1e6)}`

async function crearUsuario(client: any, datos: Record<string, unknown>) {
  const user = await User.create({
    nombre: 'Test',
    apellido: 'Admin',
    email: `adm_aj_${uniq()}@test.com`,
    password: 'Password123',
    rol: 'cliente',
    ...datos,
  } as any)
  const login = await client.post('/api/auth/login').json({ email: user.email, password: 'Password123' })
  login.assertStatus(200)
  return { user, token: login.body().token as string }
}

async function crearConductor(client: any, datos: Record<string, unknown> = {}) {
  const { user, token } = await crearUsuario(client, { rol: 'conductor', ...datos })
  const conductor = await Conductor.create({
    usuarioId: user.id,
    cedula: `${uniq()}`.slice(-10),
    placa: `ADJ${`${uniq()}`.slice(-3)}`,
    tipoVehiculo: 'camioneta',
    capacidad: '1 tonelada',
    ciudad: 'popayan',
    estadoVerificacion: 'aprobado',
  } as any)
  return { user, token, conductor }
}

test.group('Admin: ajustes del panel', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('drivers incluye usuario.esLider', async ({ client, assert }) => {
    const admin = await crearUsuario(client, { rol: 'admin' })
    const lider = await crearConductor(client, { esLider: true })

    const res = await client.get('/api/admin/drivers?limit=100').bearerToken(admin.token)
    res.assertStatus(200)
    const item = (res.body() as any[]).find((d) => Number(d.id) === Number(lider.conductor.id))
    assert.isDefined(item)
    assert.isTrue(Boolean(item.usuario.esLider))
  })

  test('marcar comisiones pagadas descuenta la deuda y levanta la suspensión por pago', async ({ client, assert }) => {
    const admin = await crearUsuario(client, { rol: 'admin' })
    const driver = await crearConductor(client, {
      montoDeuda: 15000,
      tieneDeudaActiva: true,
      estadoCuenta: 'suspension_por_pago',
      deudaFechaLimite: DateTime.now().minus({ days: 1 }),
    })
    for (const comision of [10000, 5000]) {
      await Ganancia.create({
        conductorId: driver.conductor.id,
        monto: comision * 9,
        montoBruto: comision * 10,
        comision,
        montoNeto: comision * 9,
        comisionPagada: false,
      } as any)
    }

    const res = await client.put(`/api/admin/commissions/${driver.conductor.id}/paid`).bearerToken(admin.token)
    res.assertStatus(200)
    assert.equal(res.body().montoDeuda, 0)

    const u = await User.findOrFail(driver.user.id)
    assert.isNull(u.montoDeuda)
    assert.isFalse(Boolean(u.tieneDeudaActiva))
    assert.isNull(u.deudaFechaLimite)
    assert.equal(u.estadoCuenta, 'activa')
    const pendientes = await Ganancia.query().where('conductor_id', driver.conductor.id).where('comision_pagada', false)
    assert.lengthOf(pendientes, 0)
  })

  test('si la deuda es mayor que las comisiones pendientes queda el resto', async ({ client, assert }) => {
    const admin = await crearUsuario(client, { rol: 'admin' })
    const driver = await crearConductor(client, { montoDeuda: 12000, tieneDeudaActiva: true, estadoCuenta: 'activa' })
    await Ganancia.create({
      conductorId: driver.conductor.id,
      monto: 45000,
      montoBruto: 50000,
      comision: 5000,
      montoNeto: 45000,
      comisionPagada: false,
    } as any)

    const res = await client.put(`/api/admin/commissions/${driver.conductor.id}/paid`).bearerToken(admin.token)
    res.assertStatus(200)
    const u = await User.findOrFail(driver.user.id)
    assert.equal(Number(u.montoDeuda), 7000)
    assert.isTrue(Boolean(u.tieneDeudaActiva))
  })

  test('emergencies acepta ?estado= y devuelve estado, motivo y atendidoPor', async ({ client, assert }) => {
    const admin = await crearUsuario(client, { rol: 'admin' })
    const mod = await crearUsuario(client, {
      nombre: 'Ana',
      apellido: 'Atiende',
      rol: 'moderador',
      esModerador: true,
      zonaModerador: 'popayan',
    })
    const cliente = await crearUsuario(client, { rol: 'cliente' })
    const atendida = await AlertaEmergencia.create({
      userId: cliente.user.id,
      motivo: 'Me siguen',
      estado: 'atendida',
      atendida: true,
      moderadorAtendioId: mod.user.id,
      atendidaAt: DateTime.now(),
    } as any)

    const res = await client.get('/api/admin/emergencies?limit=100&estado=pendiente,atendida').bearerToken(admin.token)
    res.assertStatus(200)
    const item = (res.body() as any[]).find((a) => Number(a.id) === Number(atendida.id))
    assert.isDefined(item)
    assert.equal(item.estado, 'atendida')
    assert.equal(item.motivo, 'Me siguen')
    assert.isString(item.estadoLabel)
    assert.equal(item.atendidoPor, 'Ana Atiende')
    assert.isString(item.atendidaAt)
  })
  test('resolver desde admin deja la alerta resuelta y la saca de la lista', async ({ client, assert }) => {
    const admin = await crearUsuario(client, { rol: 'admin' })
    const cliente = await crearUsuario(client, { rol: 'cliente' })
    const alerta = await AlertaEmergencia.create({
      userId: cliente.user.id,
      motivo: 'Accidente',
      estado: 'pendiente',
      atendida: false,
    } as any)

    const res = await client
      .put(`/api/admin/emergencies/${alerta.id}/resolve`)
      .bearerToken(admin.token)
      .json({ tipoCierre: 'accidente', observacion: 'Se llamó al usuario, todo en orden' })
    res.assertStatus(200)
    assert.equal(res.body().estado, 'resuelta')

    await alerta.refresh()
    assert.equal(alerta.estado, 'resuelta')
    assert.isTrue(Boolean(alerta.atendida))
    assert.isNotNull(alerta.resueltaAt)
    assert.equal(alerta.observacion, 'Se llamó al usuario, todo en orden')
    assert.equal(alerta.tipoCierre, 'accidente')
    assert.equal(alerta.moderadorResolvioId, admin.user.id)

    const lista = await client.get('/api/admin/emergencies?limit=100').bearerToken(admin.token)
    lista.assertStatus(200)
    assert.isUndefined((lista.body() as any[]).find((a) => Number(a.id) === Number(alerta.id)))
  })

  test('resolver desde admin sin tipoCierre ni observación exige ambos campos (auditoría)', async ({
    client,
    assert,
  }) => {
    const admin = await crearUsuario(client, { rol: 'admin' })
    const cliente = await crearUsuario(client, { rol: 'cliente' })
    const alerta = await AlertaEmergencia.create({
      userId: cliente.user.id,
      motivo: 'Accidente',
      estado: 'pendiente',
      atendida: false,
    } as any)

    const sinTipo = await client
      .put(`/api/admin/emergencies/${alerta.id}/resolve`)
      .bearerToken(admin.token)
      .json({ observacion: 'Observación con más de veinte caracteres' })
    sinTipo.assertStatus(422)
    assert.equal(sinTipo.body().error, 'Elige el tipo de caso')

    const observacionCorta = await client
      .put(`/api/admin/emergencies/${alerta.id}/resolve`)
      .bearerToken(admin.token)
      .json({ tipoCierre: 'salud', observacion: 'Muy corta' })
    observacionCorta.assertStatus(422)
    assert.equal(observacionCorta.body().error, 'Escribe la gestión realizada (mínimo 20 caracteres)')

    const ok = await client
      .put(`/api/admin/emergencies/${alerta.id}/resolve`)
      .bearerToken(admin.token)
      .json({ tipoCierre: 'salud', observacion: 'Se llamó a una ambulancia y se acompañó' })
    ok.assertStatus(200)
    assert.equal(ok.body().tipoCierre, 'salud')
    assert.equal(ok.body().tipoCierreLabel, 'Salud')

    // Ya resuelta: 409, sin exigir campos ni cambiar nada.
    const yaResuelta = await client
      .put(`/api/admin/emergencies/${alerta.id}/resolve`)
      .bearerToken(admin.token)
    yaResuelta.assertStatus(409)
  })

  test('la lista por defecto incluye las atendidas por un moderador', async ({ client, assert }) => {
    const admin = await crearUsuario(client, { rol: 'admin' })
    const cliente = await crearUsuario(client, { rol: 'cliente' })
    const atendida = await AlertaEmergencia.create({
      userId: cliente.user.id,
      estado: 'atendida',
      atendida: true,
      atendidaAt: DateTime.now(),
    } as any)
    // Resuelta por el admin antes del arreglo: quedó pendiente + atendida=true.
    const vieja = await AlertaEmergencia.create({ userId: cliente.user.id, estado: 'pendiente', atendida: true } as any)

    const res = await client.get('/api/admin/emergencies?limit=100').bearerToken(admin.token)
    res.assertStatus(200)
    const ids = (res.body() as any[]).map((a) => Number(a.id))
    assert.include(ids, Number(atendida.id))
    assert.notInclude(ids, Number(vieja.id))
  })

  test('la ciudad del conductor se valida contra las zonas de Cobertura', async ({ client, assert }) => {
    const admin = await crearUsuario(client, { rol: 'admin' })
    const driver = await crearConductor(client)
    const guardar = await client
      .put('/api/admin/config/coverage')
      .bearerToken(admin.token)
      .json({ zonasCobertura: [{ nombre: 'Tumaco', tipo: 'circulo', lat: 1.7986, lng: -78.7656, radio: 12 }] })
    guardar.assertStatus(200)

    const ok = await client
      .put(`/api/admin/drivers/${driver.conductor.id}/city`)
      .bearerToken(admin.token)
      .json({ ciudad: 'Tumaco' })
    ok.assertStatus(200)
    assert.equal(ok.body().ciudad, 'tumaco')

    const mala = await client
      .put(`/api/admin/drivers/${driver.conductor.id}/city`)
      .bearerToken(admin.token)
      .json({ ciudad: 'medellin' })
    mala.assertStatus(422)
  })
})
