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
})
