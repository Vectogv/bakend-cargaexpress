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
