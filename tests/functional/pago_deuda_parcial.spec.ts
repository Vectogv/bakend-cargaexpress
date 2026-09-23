import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import { io, type Socket } from 'socket.io-client'
import ConfiguracionPlataforma from '#models/configuracion_plataforma'
import Conductor from '#models/conductor'
import Ganancia from '#models/ganancia'
import User from '#models/user'
import DriverDebtSuspensionService from '#services/driver_debt_suspension_service'

/**
 * Al aprobar un comprobante solo se descuenta lo que ese comprobante cubría
 * (la deuda al momento de subirlo). Las comisiones de viajes terminados
 * mientras el comprobante estaba en revisión siguen como deuda, con un nuevo
 * plazo de 15 días, y solo las ganancias cubiertas quedan como comisión pagada.
 */

const uniq = () => `${Date.now()}${Math.floor(Math.random() * 1e6)}`
const URL = `http://localhost:${process.env.PORT ?? 3333}`
const ORIGEN = { direccion: 'Parque Caldas, Popayán', lat: 2.4419, lng: -76.6063 }
const DESTINO = { direccion: 'Terminal, Popayán', lat: 2.4569, lng: -76.5952 }
// PNG 1x1 válido.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64'
)

async function registrar(client: any, rol: 'cliente' | 'conductor') {
  const extra =
    rol === 'conductor'
      ? {
          cedula: `${uniq()}`.slice(-9),
          placa: `PAR${`${uniq()}`.slice(-3)}`,
          tipoVehiculo: 'camioneta',
          capacidad: '1 tonelada',
          ciudad: 'popayan',
        }
      : {}
  const res = await client.post('/api/auth/register').json({
    nombre: rol,
    apellido: 'Parcial',
    email: `parcial_${rol}_${uniq()}@test.com`,
    password: 'Password123',
    rol,
    edad: 30,
    ...extra,
  })
  res.assertStatus(200)
  const body = res.body() as { token: string; id: string }
  return { token: body.token, id: Number(body.id) }
}

async function adminToken(client: any) {
  const admin = await registrar(client, 'cliente')
  await User.query().where('id', admin.id).update({ rol: 'admin' })
  return admin.token
}

/**
 * Conductor verificado y online en el origen, con una deuda formada por
 * ganancias con comisión sin pagar de hace dos días.
 */
async function conductorConComisiones(
  client: any,
  { comisiones = [5000, 7000], vence = DateTime.now().plus({ days: 1 }), estado = 'activa' } = {}
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

  const ganancias: number[] = []
  for (const [i, comision] of comisiones.entries()) {
    const g = await Ganancia.create({
      conductorId: conductor.id,
      viajeId: null,
      monto: comision * 9,
      montoBruto: comision * 10,
      comision,
      montoNeto: comision * 9,
      comisionPagada: false,
      createdAt: DateTime.now().minus({ days: 2, minutes: 10 - i }),
    })
    ganancias.push(g.id)
  }

  const user = await User.findOrFail(usuario.id)
  user.montoDeuda = comisiones.reduce((a, b) => a + b, 0)
  user.tieneDeudaActiva = true
  user.deudaFechaLimite = vence
  user.estadoCuenta = estado
  await user.save()

  return { ...usuario, conductorId: conductor.id, ganancias }
}

async function subirComprobante(client: any, token: string) {
  const res = await client
    .post('/api/payment/proof')
    .bearerToken(token)
    .file('file', PNG, { filename: 'comprobante.png', contentType: 'image/png' })
  res.assertStatus(200)
  return res
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

async function pagadas(ids: number[]) {
  const filas = await Ganancia.query().whereIn('id', ids).orderBy('id')
  return filas.map((g) => Boolean(g.comisionPagada))
}

test.group('Aprobar pago: solo se descuenta lo que cubría el comprobante', (group) => {
  group.each.setup(async () => {
    await ConfiguracionPlataforma.query().delete()
  })

  test('si la deuda creció durante la revisión, al aprobar queda solo la comisión nueva, cuenta activa y nuevo plazo', async ({
    client,
    assert,
  }) => {
    const admin = await adminToken(client)
    const cliente = await registrar(client, 'cliente')
    const driver = await conductorConComisiones(client)

    // Toma un viaje mientras está activo.
    const pedido = await client.post('/api/trips/request').bearerToken(cliente.token).json({
      origen: ORIGEN,
      destino: DESTINO,
      descripcion: 'Caja',
      precioCliente: 60000,
    })
    pedido.assertStatus(200)
    const viajeId = (pedido.body() as { id: string }).id
    const oferta = await client.post(`/api/trips/${viajeId}/offers`).bearerToken(driver.token).json({ monto: 60000 })
    oferta.assertStatus(201)
    const ofertaId = (oferta.body() as { id: string }).id
    ;(await client.post(`/api/trips/${viajeId}/offers/${ofertaId}/accept`).bearerToken(cliente.token)).assertStatus(200)
    for (const ruta of ['confirm-arrival', 'confirm-pickup', 'start-trip']) {
      ;(await client.post(`/api/trips/${viajeId}/${ruta}`).bearerToken(driver.token)).assertStatus(200)
    }

    // La deuda vence en pleno viaje y sube el comprobante por los 12.000.
    await User.query().where('id', driver.id).update({
      deuda_fecha_limite: DateTime.now().minus({ minutes: 1 }).toSQL(),
    })
    assert.include(await DriverDebtSuspensionService.suspenderVencidos(), driver.id)
    await subirComprobante(client, driver.token)
    const enRevision = await User.findOrFail(driver.id)
    assert.equal(enRevision.estadoCuenta, 'esperando_confirmacion')
    assert.equal(Number(enRevision.montoComprobante), 12000)

    // Termina el viaje con el comprobante en revisión: +6.000 de comisión.
    await Conductor.query().where('id', driver.conductorId).update({
      ultima_ubicacion_lat: DESTINO.lat,
      ultima_ubicacion_lng: DESTINO.lng,
      ubicacion_actualizada_en: DateTime.now().toSQL(),
    })
    ;(await client.post(`/api/trips/${viajeId}/complete`).bearerToken(driver.token).json({ montoFinal: 60000 })).assertStatus(200)
    ;(await client.post(`/api/trips/${viajeId}/confirm-close`).bearerToken(cliente.token).json({ confirmar: true })).assertStatus(200)
    assert.equal(Number((await User.findOrFail(driver.id)).montoDeuda), 18000)

    const socket = await conectar(driver.token)
    const confirmados: any[] = []
    socket.on('payment:confirmed', (d) => confirmados.push(d))
    try {
      const confirma = await client.put(`/api/admin/payments/${driver.id}/confirm`).bearerToken(admin)
      confirma.assertStatus(200)
      assert.equal(Number((confirma.body() as any).montoDeuda), 6000)
      await esperar(300)
      assert.lengthOf(confirmados, 1)
      assert.equal(Number(confirmados[0].montoDeuda), 6000)
      assert.isString(confirmados[0].deudaFechaLimite)
      assert.equal(confirmados[0].estadoCuenta, 'activa')
    } finally {
      socket.disconnect()
    }

    const user = await User.findOrFail(driver.id)
    assert.equal(user.estadoCuenta, 'activa')
    assert.equal(Number(user.montoDeuda), 6000)
    assert.isTrue(Boolean(user.tieneDeudaActiva))
    assert.isNull(user.comprobantePago)
    assert.isNull(user.montoComprobante)
    const diasPlazo = user.deudaFechaLimite!.diff(DateTime.now(), 'days').days
    assert.isAbove(diasPlazo, 14.9)
    assert.isBelow(diasPlazo, 15.1)

    // Las dos comisiones viejas quedan pagadas; la del viaje nuevo no.
    assert.deepEqual(await pagadas(driver.ganancias), [true, true])
    const nueva = await Ganancia.query().where('viaje_id', viajeId).firstOrFail()
    assert.isFalse(Boolean(nueva.comisionPagada))

    // Su deuda en la app muestra solo lo pendiente.
    const deuda = await client.get('/api/payment/debt').bearerToken(driver.token)
    deuda.assertStatus(200)
    assert.equal(Number((deuda.body() as any).montoDeuda), 6000)
    assert.equal((deuda.body() as any).estadoCuenta, 'activa')

    // Puede trabajar y el barrido no lo suspende hasta que venza el nuevo plazo.
    ;(await client.put('/api/drivers/status').bearerToken(driver.token).json({ online: true })).assertStatus(200)
    assert.notInclude(await DriverDebtSuspensionService.suspenderVencidos(), driver.id)
    await User.query().where('id', driver.id).update({
      deuda_fecha_limite: DateTime.now().minus({ minutes: 1 }).toSQL(),
    })
    assert.include(await DriverDebtSuspensionService.suspenderVencidos(), driver.id)
  })

  test('si la deuda no creció, al aprobar se borra toda como antes y las comisiones quedan pagadas', async ({
    client,
    assert,
  }) => {
    const admin = await adminToken(client)
    const driver = await conductorConComisiones(client, {
      vence: DateTime.now().minus({ hours: 1 }),
      estado: 'suspension_por_pago',
    })
    await subirComprobante(client, driver.token)

    const socket = await conectar(driver.token)
    const confirmados: any[] = []
    socket.on('payment:confirmed', (d) => confirmados.push(d))
    try {
      ;(await client.put(`/api/admin/payments/${driver.id}/confirm`).bearerToken(admin)).assertStatus(200)
      await esperar(300)
      assert.lengthOf(confirmados, 1)
      assert.equal(Number(confirmados[0].montoDeuda), 0)
      assert.isNull(confirmados[0].deudaFechaLimite)
    } finally {
      socket.disconnect()
    }

    const user = await User.findOrFail(driver.id)
    assert.equal(user.estadoCuenta, 'activa')
    assert.isNull(user.montoDeuda)
    assert.isNull(user.deudaFechaLimite)
    assert.isFalse(Boolean(user.tieneDeudaActiva))
    assert.isNull(user.comprobantePago)
    assert.isNull(user.montoComprobante)
    assert.deepEqual(await pagadas(driver.ganancias), [true, true])
    assert.notInclude(await DriverDebtSuspensionService.suspenderVencidos(), driver.id)
  })

  test('solo marca pagadas las comisiones cubiertas por completo, de la más vieja a la más nueva', async ({
    client,
    assert,
  }) => {
    const admin = await adminToken(client)
    const driver = await conductorConComisiones(client, {
      comisiones: [5000, 8000],
      vence: DateTime.now().minus({ hours: 1 }),
      estado: 'suspension_por_pago',
    })
    // Deuda ajustada a mano por debajo de la suma de comisiones.
    await User.query().where('id', driver.id).update({ monto_deuda: 10000 })
    await subirComprobante(client, driver.token)

    ;(await client.put(`/api/admin/payments/${driver.id}/confirm`).bearerToken(admin)).assertStatus(200)
    assert.deepEqual(await pagadas(driver.ganancias), [true, false])
    assert.isNull((await User.findOrFail(driver.id)).montoDeuda)
  })

  test('al rechazar vuelve a suspension_por_pago, conserva la deuda y borra el monto del comprobante', async ({
    client,
    assert,
  }) => {
    const admin = await adminToken(client)
    const driver = await conductorConComisiones(client, {
      vence: DateTime.now().minus({ hours: 1 }),
      estado: 'suspension_por_pago',
    })
    await subirComprobante(client, driver.token)
    assert.equal(Number((await User.findOrFail(driver.id)).montoComprobante), 12000)

    ;(await client.put(`/api/admin/payments/${driver.id}/reject`).bearerToken(admin)).assertStatus(200)

    const user = await User.findOrFail(driver.id)
    assert.equal(user.estadoCuenta, 'suspension_por_pago')
    assert.equal(Number(user.montoDeuda), 12000)
    assert.isNull(user.comprobantePago)
    assert.isNull(user.montoComprobante)
    assert.isNull(user.comprobanteSubidoAt)
    assert.deepEqual(await pagadas(driver.ganancias), [false, false])
  })

  test('cliente con acuerdo de pago: al aprobar su comprobante se borra toda la deuda como antes', async ({
    client,
    assert,
  }) => {
    const admin = await adminToken(client)
    const cliente = await registrar(client, 'cliente')
    // Estado que deja resolveDispute con acuerdoDePago.
    await User.query().where('id', cliente.id).update({
      estado_cuenta: 'suspension_por_pago',
      monto_deuda: 20000,
      deuda_fecha_limite: DateTime.now().plus({ days: 10 }).toSQL(),
      tiene_deuda_activa: true,
    })
    await subirComprobante(client, cliente.token)
    assert.equal(Number((await User.findOrFail(cliente.id)).montoComprobante), 20000)

    const confirma = await client.put(`/api/admin/payments/${cliente.id}/confirm`).bearerToken(admin)
    confirma.assertStatus(200)
    assert.equal(Number((confirma.body() as any).montoDeuda), 0)

    const user = await User.findOrFail(cliente.id)
    assert.equal(user.estadoCuenta, 'activa')
    assert.isNull(user.montoDeuda)
    assert.isNull(user.deudaFechaLimite)
    assert.isFalse(Boolean(user.tieneDeudaActiva))
    assert.isNull(user.montoComprobante)
  })

  test('comprobante en revisión subido antes de este cambio (sin monto): al aprobar se borra toda la deuda', async ({
    client,
    assert,
  }) => {
    const admin = await adminToken(client)
    const driver = await conductorConComisiones(client, { estado: 'esperando_confirmacion' })
    await User.query().where('id', driver.id).update({
      comprobante_pago: '/storage/uploads/c.png',
      monto_deuda: 18000,
    })

    ;(await client.put(`/api/admin/payments/${driver.id}/confirm`).bearerToken(admin)).assertStatus(200)
    const user = await User.findOrFail(driver.id)
    assert.equal(user.estadoCuenta, 'activa')
    assert.isNull(user.montoDeuda)
    assert.isFalse(Boolean(user.tieneDeudaActiva))
  })
})
