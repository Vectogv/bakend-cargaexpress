import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import { io, type Socket } from 'socket.io-client'
import ConfiguracionPlataforma from '#models/configuracion_plataforma'
import Conductor from '#models/conductor'
import Notificacion from '#models/notificacion'
import User from '#models/user'
import DriverDebtSuspensionService from '#services/driver_debt_suspension_service'

/**
 * Suspensión por pago del conductor: cuando la deuda de comisión supera su
 * fecha límite (15 días desde el primer viaje sin pagar) la cuenta pasa a
 * `suspension_por_pago`. Mientras tanto el conductor puede subir el comprobante
 * pero no conectarse ni ofertar hasta que el admin apruebe el pago.
 */

const uniq = () => `${Date.now()}${Math.floor(Math.random() * 1e6)}`
const URL = `http://localhost:${process.env.PORT ?? 3333}`
const ORIGEN = { direccion: 'Parque Caldas, Popayán', lat: 2.4419, lng: -76.6063 }
const DESTINO = { direccion: 'Terminal, Popayán', lat: 2.4569, lng: -76.5952 }

async function registrar(client: any, rol: 'cliente' | 'conductor') {
  const extra =
    rol === 'conductor'
      ? {
          cedula: `${uniq()}`.slice(-9),
          placa: `DEU${`${uniq()}`.slice(-3)}`,
          tipoVehiculo: 'camioneta',
          capacidad: '1 tonelada',
          ciudad: 'popayan',
        }
      : {}
  const res = await client.post('/api/auth/register').json({
    nombre: rol,
    apellido: 'Deuda',
    email: `deuda_${rol}_${uniq()}@test.com`,
    password: 'Password123',
    rol,
    edad: 30,
    ...extra,
  })
  res.assertStatus(200)
  const body = res.body() as { token: string; id: string }
  return { token: body.token, id: Number(body.id) }
}

/** Conductor verificado, ubicado en el origen y online, con la deuda indicada. */
async function conductorConDeuda(
  client: any,
  { monto = 12000, vence = DateTime.now().minus({ hours: 1 }), estado = 'activa' } = {}
) {
  const usuario = await registrar(client, 'conductor')
  const conductor = await Conductor.findByOrFail('usuario_id', usuario.id)
  conductor.estadoVerificacion = 'aprobado'
  conductor.ciudad = 'popayan'
  conductor.ultimaUbicacionLat = ORIGEN.lat
  conductor.ultimaUbicacionLng = ORIGEN.lng
  conductor.ubicacionActualizadaEn = DateTime.now()
  conductor.online = true
  await conductor.save()

  const user = await User.findOrFail(usuario.id)
  user.montoDeuda = monto
  user.tieneDeudaActiva = monto > 0
  user.deudaFechaLimite = vence
  user.estadoCuenta = estado
  await user.save()

  return { ...usuario, conductorId: conductor.id }
}

async function registrarCliente(client: any) {
  const cliente = await registrar(client, 'cliente')
  return cliente.token
}

const pedirViaje = async (client: any, token: string) => {
  const res = await client.post('/api/trips/request').bearerToken(token).json({
    origen: ORIGEN,
    destino: DESTINO,
    descripcion: 'Caja',
    precioCliente: 60000,
  })
  res.assertStatus(200)
  return (res.body() as { id: string }).id
}

function conectar(token: string): Promise<Socket> {
  const socket = io(URL, {
    transports: ['websocket'],
    auth: { token: `Bearer ${token}` },
    query: { token },
  })
  return new Promise((resolve, reject) => {
    socket.once('connect', () => resolve(socket))
    socket.once('connect_error', reject)
  })
}

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms))

test.group('Suspensión por deuda vencida del conductor', (group) => {
  group.each.setup(async () => {
    await ConfiguracionPlataforma.query().delete()
  })

  test('suspende solo a conductores activos con deuda vencida, los pone offline y es idempotente', async ({
    client,
    assert,
  }) => {
    const vencido = await conductorConDeuda(client)
    const vigente = await conductorConDeuda(client, { vence: DateTime.now().plus({ days: 3 }) })
    const sinDeuda = await conductorConDeuda(client, { monto: 0 })
    const esperando = await conductorConDeuda(client, { estado: 'esperando_confirmacion' })

    // Un cliente con deuda vencida (acuerdo de pago por disputa) no se toca aquí.
    const cliente = await registrar(client, 'cliente')
    await User.query().where('id', cliente.id).update({
      monto_deuda: 5000,
      deuda_fecha_limite: DateTime.now().minus({ days: 1 }).toSQL(),
      estado_cuenta: 'activa',
    })

    const suspendidos = await DriverDebtSuspensionService.suspenderVencidos()
    assert.include(suspendidos, vencido.id)
    assert.notInclude(suspendidos, vigente.id)
    assert.notInclude(suspendidos, sinDeuda.id)
    assert.notInclude(suspendidos, esperando.id)
    assert.notInclude(suspendidos, cliente.id)

    const estado = async (id: number) => (await User.findOrFail(id)).estadoCuenta
    assert.equal(await estado(vencido.id), 'suspension_por_pago')
    assert.equal(await estado(vigente.id), 'activa')
    assert.equal(await estado(sinDeuda.id), 'activa')
    assert.equal(await estado(esperando.id), 'esperando_confirmacion')
    assert.equal(await estado(cliente.id), 'activa')

    const conductor = await Conductor.findOrFail(vencido.conductorId)
    assert.isFalse(Boolean(conductor.online))
    assert.isTrue(Boolean((await Conductor.findOrFail(vigente.conductorId)).online))

    const avisos = await Notificacion.query()
      .where('usuario_id', vencido.id)
      .where('tipo', 'suspension_por_pago')
    assert.lengthOf(avisos, 1)

    // Otro barrido (u otra réplica a la vez) no vuelve a suspender ni notificar.
    const [a, b] = await Promise.all([
      DriverDebtSuspensionService.suspenderVencidos(),
      DriverDebtSuspensionService.suspenderVencidos(),
    ])
    assert.notInclude([...a, ...b], vencido.id)
    const avisosDespues = await Notificacion.query()
      .where('usuario_id', vencido.id)
      .where('tipo', 'suspension_por_pago')
    assert.lengthOf(avisosDespues, 1)
  })

  test('avisa al conductor por socket con notification:new y account:payment_suspended', async ({
    client,
    assert,
  }) => {
    const vencido = await conductorConDeuda(client, { monto: 15000 })
    const socket = await conectar(vencido.token)
    const notificaciones: any[] = []
    const suspensiones: any[] = []
    socket.on('notification:new', (d) => notificaciones.push(d))
    socket.on('account:payment_suspended', (d) => suspensiones.push(d))

    try {
      await DriverDebtSuspensionService.suspenderVencidos()
      await esperar(500)

      assert.isTrue(notificaciones.some((n) => n.tipo === 'suspension_por_pago'))
      assert.lengthOf(suspensiones, 1)
      assert.equal(suspensiones[0].estadoCuenta, 'suspension_por_pago')
      assert.equal(Number(suspensiones[0].montoDeuda), 15000)
      assert.equal(suspensiones[0].code, 'CUENTA_SUSPENDIDA_POR_PAGO')
    } finally {
      socket.disconnect()
    }
  })
})

const CODE = 'CUENTA_SUSPENDIDA_POR_PAGO'

test.group('Conductor suspendido por pago: qué puede y qué no', (group) => {
  group.each.setup(async () => {
    await ConfiguracionPlataforma.query().delete()
  })

  for (const estado of ['suspension_por_pago', 'esperando_confirmacion']) {
    test(`en ${estado} no puede ponerse online pero sí offline`, async ({ client, assert }) => {
      const driver = await conductorConDeuda(client, { estado })
      await Conductor.query().where('id', driver.conductorId).update({ online: false })

      const online = await client.put('/api/drivers/status').bearerToken(driver.token).json({ online: true })
      online.assertStatus(403)
      online.assertBodyContains({ code: CODE, estadoCuenta: estado })
      assert.isString((online.body() as any).error)
      assert.isFalse(Boolean((await Conductor.findOrFail(driver.conductorId)).online))

      const offline = await client.put('/api/drivers/status').bearerToken(driver.token).json({ online: false })
      offline.assertStatus(200)
    })

    test(`en ${estado} no puede ofertar`, async ({ client }) => {
      const tokenC = await registrarCliente(client)
      const driver = await conductorConDeuda(client, { estado })
      const viajeId = await pedirViaje(client, tokenC)

      const oferta = await client.post(`/api/trips/${viajeId}/offers`).bearerToken(driver.token).json({ monto: 50000 })
      oferta.assertStatus(403)
      oferta.assertBodyContains({ code: CODE, estadoCuenta: estado })
    })
  }

  test('suspendido puede iniciar sesión, ver su deuda y ganancias, y subir el comprobante', async ({
    client,
    assert,
  }) => {
    const driver = await conductorConDeuda(client, { estado: 'suspension_por_pago' })
    const user = await User.findOrFail(driver.id)

    const login = await client.post('/api/auth/login').json({ email: user.email, password: 'Password123' })
    login.assertStatus(200)

    const deuda = await client.get('/api/payment/debt').bearerToken(driver.token)
    deuda.assertStatus(200)
    assert.equal((deuda.body() as any).estadoCuenta, 'suspension_por_pago')

    const ganancias = await client.get('/api/drivers/earnings').bearerToken(driver.token)
    ganancias.assertStatus(200)

    // Sin archivo: pasa el control de estado y falla solo por el archivo.
    const comprobante = await client.post('/api/payment/proof').bearerToken(driver.token)
    comprobante.assertStatus(400)
  })

  test('el cliente no puede aceptar la oferta de un conductor suspendido después de ofertar', async ({
    client,
  }) => {
    const tokenC = await registrarCliente(client)
    const driver = await conductorConDeuda(client, { vence: DateTime.now().plus({ days: 1 }) })
    const viajeId = await pedirViaje(client, tokenC)
    const oferta = await client.post(`/api/trips/${viajeId}/offers`).bearerToken(driver.token).json({ monto: 50000 })
    oferta.assertStatus(201)
    const ofertaId = (oferta.body() as { id: string }).id

    await User.query().where('id', driver.id).update({ estado_cuenta: 'suspension_por_pago' })

    const acepta = await client.post(`/api/trips/${viajeId}/offers/${ofertaId}/accept`).bearerToken(tokenC)
    acepta.assertStatus(409)
  })

  test('el endpoint obsoleto de aceptación directa también lo bloquea', async ({ client }) => {
    const tokenC = await registrarCliente(client)
    const driver = await conductorConDeuda(client, { estado: 'suspension_por_pago' })
    const viajeId = await pedirViaje(client, tokenC)

    const acepta = await client.post(`/api/trips/${viajeId}/accept`).bearerToken(driver.token)
    acepta.assertStatus(403)
    acepta.assertBodyContains({ code: CODE })
  })

  test('si lo suspenden en pleno viaje, puede terminarlo pero queda offline', async ({ client, assert }) => {
    const tokenC = await registrarCliente(client)
    const driver = await conductorConDeuda(client, { vence: DateTime.now().plus({ days: 1 }) })
    const viajeId = await pedirViaje(client, tokenC)
    const oferta = await client.post(`/api/trips/${viajeId}/offers`).bearerToken(driver.token).json({ monto: 60000 })
    const ofertaId = (oferta.body() as { id: string }).id
    ;(await client.post(`/api/trips/${viajeId}/offers/${ofertaId}/accept`).bearerToken(tokenC)).assertStatus(200)
    for (const ruta of ['confirm-arrival', 'confirm-pickup', 'start-trip']) {
      ;(await client.post(`/api/trips/${viajeId}/${ruta}`).bearerToken(driver.token)).assertStatus(200)
    }

    // La deuda vence durante el viaje.
    await User.query().where('id', driver.id).update({
      deuda_fecha_limite: DateTime.now().minus({ minutes: 1 }).toSQL(),
    })
    assert.include(await DriverDebtSuspensionService.suspenderVencidos(), driver.id)

    await Conductor.query().where('id', driver.conductorId).update({
      ultima_ubicacion_lat: DESTINO.lat,
      ultima_ubicacion_lng: DESTINO.lng,
      ubicacion_actualizada_en: DateTime.now().toSQL(),
    })
    const completa = await client.post(`/api/trips/${viajeId}/complete`).bearerToken(driver.token).json({ montoFinal: 60000 })
    completa.assertStatus(200)
    const cierre = await client.post(`/api/trips/${viajeId}/confirm-close`).bearerToken(tokenC).json({ confirmar: true })
    cierre.assertStatus(200)
    assert.equal((cierre.body() as any).estado, 'finalizado')

    assert.isFalse(Boolean((await Conductor.findOrFail(driver.conductorId)).online))
    const user = await User.findOrFail(driver.id)
    assert.equal(user.estadoCuenta, 'suspension_por_pago')
    assert.isAbove(Number(user.montoDeuda), 12000)
  })
})
