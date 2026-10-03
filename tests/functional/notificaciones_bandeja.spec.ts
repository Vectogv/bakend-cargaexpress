import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import Notificacion from '#models/notificacion'
import { sendToToken } from '#services/push_notification_service'

async function register(client: any, body: Record<string, any>): Promise<{ token: string; id: number }> {
  const res = await client.post('/api/auth/register').json(body)
  res.assertStatus(200)
  return res.body()
}

async function cliente(client: any, sufijo: string) {
  return register(client, {
    nombre: 'Cli',
    apellido: 'Bandeja',
    email: `bandeja-${sufijo}-${Date.now()}@test.com`,
    password: '123456',
    rol: 'cliente',
    edad: 30,
  })
}

test.group('Notificaciones - bandeja (read-all, viajeId/ticketId, fila por push)', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('PUT /read-all marca solo las del usuario y devuelve cuántas cambió', async ({ client, assert }) => {
    const yo = await cliente(client, 'yo')
    const otro = await cliente(client, 'otro')
    await Notificacion.createMany([
      { usuarioId: yo.id, tipo: 'a', titulo: 'A', mensaje: null, leido: false },
      { usuarioId: yo.id, tipo: 'b', titulo: 'B', mensaje: null, leido: false },
      { usuarioId: yo.id, tipo: 'c', titulo: 'C', mensaje: null, leido: true },
      { usuarioId: otro.id, tipo: 'd', titulo: 'D', mensaje: null, leido: false },
    ])

    const res = await client.put('/api/notifications/read-all').header('Authorization', `Bearer ${yo.token}`)
    res.assertStatus(200)
    assert.equal(res.body().actualizadas, 2)

    const mias = await Notificacion.query().where('usuario_id', yo.id)
    assert.isTrue(mias.every((n) => Boolean(n.leido)))
    const ajena = await Notificacion.query().where('usuario_id', otro.id).firstOrFail()
    assert.isFalse(Boolean(ajena.leido))

    // Segunda vez: nada que marcar.
    const otraVez = await client.put('/api/notifications/read-all').header('Authorization', `Bearer ${yo.token}`)
    otraVez.assertStatus(200)
    assert.equal(otraVez.body().actualizadas, 0)
  })

  test('PUT /read-all sin sesión responde 401', async ({ client }) => {
    const res = await client.put('/api/notifications/read-all')
    res.assertStatus(401)
  })

  test('GET /api/notifications trae viajeId y ticketId como texto (o null)', async ({ client, assert }) => {
    const yo = await cliente(client, 'ids')
    await Notificacion.create({ usuarioId: yo.id, tipo: 'viaje_estado', titulo: 'V', mensaje: 'x', leido: false, viajeId: 77 })
    await Notificacion.create({ usuarioId: yo.id, tipo: 'ticket_mensaje', titulo: 'T', mensaje: 'y', leido: false, ticketId: 5 })
    await Notificacion.create({ usuarioId: yo.id, tipo: 'otro', titulo: 'O', mensaje: null, leido: false })

    const res = await client.get('/api/notifications').header('Authorization', `Bearer ${yo.token}`)
    res.assertStatus(200)
    const porTitulo = Object.fromEntries(res.body().map((n: any) => [n.titulo, n]))
    assert.equal(porTitulo.V.viajeId, '77')
    assert.isNull(porTitulo.V.ticketId)
    assert.equal(porTitulo.T.ticketId, '5')
    assert.isNull(porTitulo.T.viajeId)
    assert.isNull(porTitulo.O.viajeId)
    assert.isNull(porTitulo.O.ticketId)
  })

  test('un push de estado del viaje deja una fila en la bandeja del dueño del token', async ({ client, assert }) => {
    const yo = await cliente(client, 'push')
    const token = `fcm-bandeja-${yo.id}`
    const reg = await client
      .put('/api/users/fcm-token')
      .header('Authorization', `Bearer ${yo.token}`)
      .json({ fcmToken: token })
    reg.assertStatus(200)

    await sendToToken(token, 'Conductor en camino', 'Va hacia ti', { tipo: 'viaje_estado', viajeId: '123' })
    await sendToToken(token, 'Reserva asignada', 'Listo', { tipo: 'reserva', viajeId: '124' })
    // Otros tipos no van a la bandeja (tienen su propia fila o no la necesitan).
    await sendToToken(token, 'Mensaje', 'Hola', { tipo: 'conversacion_mensaje', conversacionId: '9' })
    // Token desconocido: no crea nada ni lanza.
    await sendToToken('fcm-de-nadie', 'X', 'Y', { tipo: 'viaje_estado', viajeId: '1' })

    const filas = await Notificacion.query().where('usuario_id', yo.id).orderBy('id')
    assert.lengthOf(filas, 2)
    assert.equal(filas[0].tipo, 'viaje_estado')
    assert.equal(filas[0].titulo, 'Conductor en camino')
    assert.equal(filas[0].mensaje, 'Va hacia ti')
    assert.equal(Number(filas[0].viajeId), 123)
    assert.isFalse(Boolean(filas[0].leido))
    assert.equal(filas[1].tipo, 'reserva')
    assert.equal(Number(filas[1].viajeId), 124)

    const res = await client.get('/api/notifications').header('Authorization', `Bearer ${yo.token}`)
    res.assertStatus(200)
    const reserva = res.body().find((n: any) => n.titulo === 'Reserva asignada')
    assert.equal(reserva.viajeId, '124')
    assert.lengthOf(res.body(), 2)
  })
})
