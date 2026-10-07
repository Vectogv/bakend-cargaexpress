import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import ConfiguracionPlataforma from '#models/configuracion_plataforma'
import Conductor from '#models/conductor'
import CuponComision from '#models/cupon_comision'
import Ganancia from '#models/ganancia'
import Referido from '#models/referido'
import User from '#models/user'

/**
 * Programa de referidos (fase 1): código en el registro, cupón del invitado al
 * aprobarlo, meta de viajes con clientes distintos, cupón del referidor, tope
 * mensual, vencimiento y anulación.
 */

const uniq = () => `${Date.now()}${Math.floor(Math.random() * 1e6)}`
const ORIGEN = { direccion: 'Parque Caldas, Popayán', lat: 2.4419, lng: -76.6063 }
const DESTINO = { direccion: 'Terminal, Popayán', lat: 2.4569, lng: -76.5952 }
const PRECIO = 20000

async function registrar(client: any, rol: 'cliente' | 'conductor', extra: Record<string, unknown> = {}) {
  const base =
    rol === 'conductor'
      ? {
          cedula: `${uniq()}`.slice(-9),
          placa: `R${`${uniq()}`.slice(-9)}`, // única en toda la suite (3 dígitos al azar chocaban)
          tipoVehiculo: 'camioneta',
          capacidad: '1 tonelada',
          ciudad: 'popayan',
        }
      : {}
  return client.post('/api/auth/register').json({
    nombre: 'Pedro',
    apellido: 'Referido',
    email: `ref_${rol}_${uniq()}@test.com`,
    password: 'Password123',
    rol,
    edad: 30,
    ...base,
    ...extra,
  })
}

async function cuenta(client: any, rol: 'cliente' | 'conductor', extra: Record<string, unknown> = {}) {
  const res = await registrar(client, rol, extra)
  res.assertStatus(200)
  const body = res.body() as { token: string; id: string }
  return { token: body.token, id: Number(body.id) }
}

async function adminToken(client: any) {
  const admin = await cuenta(client, 'cliente')
  await User.query().where('id', admin.id).update({ rol: 'admin' })
  return admin.token
}

async function activarPrograma(client: any, admin: string, referidos: Record<string, unknown> = {}) {
  const res = await client
    .put('/api/admin/config')
    .bearerToken(admin)
    .json({ referidos: { activo: true, ...referidos } })
  res.assertStatus(200)
}

/** Conductor registrado (con código de invitación opcional), aprobado por el admin y en el origen. */
async function conductorListo(client: any, admin: string, codigoReferido?: string) {
  const usuario = await cuenta(client, 'conductor', codigoReferido ? { codigoReferido } : {})
  const conductor = await Conductor.findByOrFail('usuario_id', usuario.id)
  ;(await client.put(`/api/admin/verifications/${conductor.id}/approve`).bearerToken(admin)).assertStatus(200)
  conductor.ultimaUbicacionLat = ORIGEN.lat
  conductor.ultimaUbicacionLng = ORIGEN.lng
  conductor.ubicacionActualizadaEn = DateTime.now()
  conductor.online = true
  await conductor.save()
  return { ...usuario, conductorId: conductor.id }
}

async function codigoDe(client: any, token: string): Promise<string> {
  const res = await client.get('/api/drivers/referidos').bearerToken(token)
  res.assertStatus(200)
  return (res.body() as any).codigo
}

/** Viaje completo cliente→conductor hasta `finalizado`; devuelve la comisión cobrada. */
async function viajeCompleto(client: any, cliente: string, driver: { token: string; conductorId: number }) {
  const pedido = await client.post('/api/trips/request').bearerToken(cliente).json({
    origen: ORIGEN,
    destino: DESTINO,
    descripcion: 'Caja',
    precioCliente: PRECIO,
  })
  pedido.assertStatus(200)
  const viajeId = (pedido.body() as { id: string }).id
  await Conductor.query().where('id', driver.conductorId).update({
    ultima_ubicacion_lat: ORIGEN.lat,
    ultima_ubicacion_lng: ORIGEN.lng,
    ubicacion_actualizada_en: DateTime.now().toSQL(),
  })
  const oferta = await client.post(`/api/trips/${viajeId}/offers`).bearerToken(driver.token).json({ monto: PRECIO })
  oferta.assertStatus(201)
  const ofertaId = (oferta.body() as { id: string }).id
  const acepta = await client.post(`/api/trips/${viajeId}/offers/${ofertaId}/accept`).bearerToken(cliente)
  acepta.assertStatus(200)
  for (const ruta of ['confirm-arrival', 'confirm-pickup', 'start-trip']) {
    ;(await client.post(`/api/trips/${viajeId}/${ruta}`).bearerToken(driver.token)).assertStatus(200)
  }
  await Conductor.query().where('id', driver.conductorId).update({
    ultima_ubicacion_lat: DESTINO.lat,
    ultima_ubicacion_lng: DESTINO.lng,
    ubicacion_actualizada_en: DateTime.now().toSQL(),
  })
  ;(
    await client
      .post(`/api/trips/${viajeId}/complete`)
      .bearerToken(driver.token)
      .json({ montoFinal: PRECIO, pin: (acepta.body() as any).pinEntrega })
  ).assertStatus(200)
  ;(await client.post(`/api/trips/${viajeId}/confirm-close`).bearerToken(cliente).json({ confirmar: true })).assertStatus(200)
  const ganancia = await Ganancia.query().where('viaje_id', viajeId).firstOrFail()
  return { viajeId: Number(viajeId), comision: Number(ganancia.comision), cuponId: ganancia.cuponId }
}

test.group('Programa de referidos', (group) => {
  // Antes y después: otros grupos (reservas) crean su propia fila y leen la más vieja.
  group.each.setup(async () => {
    await ConfiguracionPlataforma.query().delete()
  })
  group.each.teardown(async () => {
    await ConfiguracionPlataforma.query().delete()
  })

  test('un código que no existe da 422 CODIGO_INVALIDO', async ({ client, assert }) => {
    const admin = await adminToken(client)
    await activarPrograma(client, admin)
    const res = await registrar(client, 'conductor', { codigoReferido: 'NOEXISTE1' })
    res.assertStatus(422)
    assert.equal((res.body() as any).code, 'CODIGO_INVALIDO')
  })

  test('con el programa apagado el código se ignora y no se crea el referido', async ({ client, assert }) => {
    const admin = await adminToken(client)
    const referidor = await conductorListo(client, admin)
    const codigo = await codigoDe(client, referidor.token)
    const invitado = await conductorListo(client, admin, codigo)
    assert.isNull(await Referido.query().where('invitado_conductor_id', invitado.conductorId).first())
    const res = await client.get('/api/drivers/referidos').bearerToken(referidor.token)
    assert.isFalse((res.body() as any).programaActivo)
    assert.lengthOf((res.body() as any).invitados, 0)
  })

  test('el invitado paga 5 % en sus 3 primeros viajes y vuelve al 10 % en el cuarto', async ({ client, assert }) => {
    const admin = await adminToken(client)
    await activarPrograma(client, admin, { clientesDistintos: false })
    const referidor = await conductorListo(client, admin)
    const invitado = await conductorListo(client, admin, await codigoDe(client, referidor.token))
    const cliente = (await cuenta(client, 'cliente')).token

    for (let i = 0; i < 3; i++) {
      const v = await viajeCompleto(client, cliente, invitado)
      assert.equal(v.comision, PRECIO * 0.05, `viaje ${i + 1}`)
      assert.isNotNull(v.cuponId)
    }
    const cuarto = await viajeCompleto(client, cliente, invitado)
    assert.equal(cuarto.comision, PRECIO * 0.1)
    assert.isNull(cuarto.cuponId)

    // El historial del conductor trae la comisión real de cada viaje.
    const historial = await client.get('/api/trips/history').bearerToken(invitado.token)
    historial.assertStatus(200)
    const lista = ((historial.body() as any).data as any[]).map((v) => Number(v.comision)).sort((a, b) => a - b)
    assert.deepEqual(lista, [1000, 1000, 1000, 2000])
  })

  test('3 viajes con el mismo cliente no activan el referido', async ({ client, assert }) => {
    const admin = await adminToken(client)
    await activarPrograma(client, admin)
    const referidor = await conductorListo(client, admin)
    const invitado = await conductorListo(client, admin, await codigoDe(client, referidor.token))
    const cliente = (await cuenta(client, 'cliente')).token
    for (let i = 0; i < 3; i++) await viajeCompleto(client, cliente, invitado)

    const referido = await Referido.findByOrFail('invitado_conductor_id', invitado.conductorId)
    assert.equal(referido.estado, 'pendiente')
    const res = await client.get('/api/drivers/referidos').bearerToken(referidor.token)
    assert.equal((res.body() as any).invitados[0].viajes, 1)
    assert.lengthOf((res.body() as any).cupones, 0)
  })

  test('3 clientes distintos activan el referido y crean el cupón del referidor', async ({ client, assert }) => {
    const admin = await adminToken(client)
    await activarPrograma(client, admin)
    // La base de pruebas acumula lo de los otros tests del mes: se mide la diferencia.
    const noCobradaAntes = ((await client.get('/api/admin/referidos').bearerToken(admin)).body() as any)
      .comisionNoCobradaMes as number
    const referidor = await conductorListo(client, admin)
    const invitado = await conductorListo(client, admin, await codigoDe(client, referidor.token))
    for (let i = 0; i < 3; i++) {
      const cliente = (await cuenta(client, 'cliente')).token
      await viajeCompleto(client, cliente, invitado)
    }

    const referido = await Referido.findByOrFail('invitado_conductor_id', invitado.conductorId)
    assert.equal(referido.estado, 'activo')
    assert.isNotNull(referido.activadoEn)
    const cupon = await CuponComision.query()
      .where('conductor_id', referidor.conductorId)
      .where('tipo', 'referidor')
      .firstOrFail()
    assert.equal(Number(cupon.pct), 0)
    assert.equal(cupon.usosRestantes, 3)

    // El referidor lo ve en su resumen y su próximo viaje va al 0 %.
    const res = await client.get('/api/drivers/referidos').bearerToken(referidor.token)
    const body = res.body() as any
    assert.equal(body.invitados[0].estado, 'activo')
    assert.equal(body.cupones[0].tipo, 'referidor')
    const cliente = (await cuenta(client, 'cliente')).token
    const v = await viajeCompleto(client, cliente, referidor)
    assert.equal(v.comision, 0)
    assert.equal(v.cuponId, cupon.id)

    // El admin ve la comisión no cobrada: 3 × 1.000 (invitado) + 2.000 (referidor).
    const adminRes = await client.get('/api/admin/referidos').bearerToken(admin)
    adminRes.assertStatus(200)
    const resumen = adminRes.body() as any
    assert.equal(resumen.comisionNoCobradaMes - noCobradaAntes, 5000)
    assert.equal(resumen.topeMensualPesos, 500000)
    const fila = resumen.referidos.find((r: any) => r.id === referido.id)
    assert.equal(fila.estado, 'activo')
    assert.equal(fila.referidor.id, referidor.conductorId)
    assert.lengthOf(fila.cupones, 2)
  })

  test('un cupón vencido no aplica', async ({ client, assert }) => {
    const admin = await adminToken(client)
    await activarPrograma(client, admin)
    const referidor = await conductorListo(client, admin)
    const invitado = await conductorListo(client, admin, await codigoDe(client, referidor.token))
    await CuponComision.query()
      .where('conductor_id', invitado.conductorId)
      .update({ vence_en: DateTime.now().minus({ minutes: 1 }).toSQL() })
    const cliente = (await cuenta(client, 'cliente')).token
    const v = await viajeCompleto(client, cliente, invitado)
    assert.equal(v.comision, PRECIO * 0.1)
    assert.isNull(v.cuponId)
  })

  test('con el tope mensual alcanzado se cobra el 10 %', async ({ client, assert }) => {
    const admin = await adminToken(client)
    await activarPrograma(client, admin)
    // Tope = lo ya no cobrado este mes (otros tests) + 1.500: cabe un descuento de 1.000, no dos.
    const noCobradaAntes = ((await client.get('/api/admin/referidos').bearerToken(admin)).body() as any)
      .comisionNoCobradaMes as number
    await activarPrograma(client, admin, { topeMensualPesos: noCobradaAntes + 1500 })
    const referidor = await conductorListo(client, admin)
    const invitado = await conductorListo(client, admin, await codigoDe(client, referidor.token))
    const cliente = (await cuenta(client, 'cliente')).token
    const primero = await viajeCompleto(client, cliente, invitado) // deja de cobrar 1.000: cabe
    assert.equal(primero.comision, PRECIO * 0.05)
    const segundo = await viajeCompleto(client, cliente, invitado) // 2.000 > 1.500: no cabe
    assert.equal(segundo.comision, PRECIO * 0.1)
    assert.isNull(segundo.cuponId)
    const cupon = await CuponComision.query().where('conductor_id', invitado.conductorId).firstOrFail()
    assert.equal(cupon.usosRestantes, 2)
  })

  test('anular el referido apaga sus cupones', async ({ client, assert }) => {
    const admin = await adminToken(client)
    await activarPrograma(client, admin)
    const referidor = await conductorListo(client, admin)
    const invitado = await conductorListo(client, admin, await codigoDe(client, referidor.token))
    const referido = await Referido.findByOrFail('invitado_conductor_id', invitado.conductorId)
    const res = await client.put(`/api/admin/referidos/${referido.id}/anular`).bearerToken(admin)
    res.assertStatus(200)
    assert.equal((res.body() as any).estado, 'anulado')
    const cliente = (await cuenta(client, 'cliente')).token
    const v = await viajeCompleto(client, cliente, invitado)
    assert.equal(v.comision, PRECIO * 0.1)
    assert.isNull(v.cuponId)
    ;(await client.put('/api/admin/referidos/999999/anular').bearerToken(admin)).assertStatus(404)
  })

  test('GET /api/drivers/referidos tiene la forma del contrato', async ({ client, assert }) => {
    const admin = await adminToken(client)
    await activarPrograma(client, admin)
    const referidor = await conductorListo(client, admin)
    const codigo = await codigoDe(client, referidor.token)
    assert.match(codigo, /^PEDRO\d{3}[A-Z]*$/)
    const invitado = await conductorListo(client, admin, codigo)

    const propio = (await client.get('/api/drivers/referidos').bearerToken(referidor.token)).body() as any
    assert.equal(propio.programaActivo, true)
    assert.equal(propio.codigo, codigo)
    assert.deepEqual(propio.reglas, {
      viajesMeta: 3,
      diasMeta: 30,
      clientesDistintos: true,
      invitado: { pct: 5, viajes: 3 },
      referidor: { pct: 0, viajes: 3, diasUso: 30 },
    })
    assert.lengthOf(propio.invitados, 1)
    assert.include(propio.invitados[0], { nombre: 'Pedro Referido', viajes: 0, meta: 3, estado: 'pendiente' })
    assert.isString(propio.invitados[0].venceEn)
    assert.deepEqual(propio.cupones, [])
    assert.isNull(propio.miProgreso)

    const delInvitado = (await client.get('/api/drivers/referidos').bearerToken(invitado.token)).body() as any
    assert.lengthOf(delInvitado.invitados, 0)
    assert.lengthOf(delInvitado.cupones, 1)
    assert.include(delInvitado.cupones[0], { tipo: 'invitado', pct: 5, usosRestantes: 3 })
    assert.include(delInvitado.miProgreso, { viajes: 0, meta: 3 })
    assert.isString(delInvitado.miProgreso.venceEn)

    // Un cliente no entra; el admin valida el rango de pct.
    const cliente = (await cuenta(client, 'cliente')).token
    ;(await client.get('/api/drivers/referidos').bearerToken(cliente)).assertStatus(403)
    ;(await client.put('/api/admin/config').bearerToken(admin).json({ referidos: { invitado: { pct: 11 } } })).assertStatus(422)
  })
})
