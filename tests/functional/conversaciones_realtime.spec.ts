import { test } from '@japa/runner'
import { io, type Socket } from 'socket.io-client'
import User from '#models/user'

/**
 * Conversatorio en tiempo real: al enviar un mensaje, el panel de admin y el del
 * moderador deben recibir el evento `conversation:message` una sola vez.
 *
 * Regresión: cuando la conversación tenía ciudad, el mensaje se emitía solo a
 * `moderator:{ciudad}` y al otro participante, así que el admin no recibía nada
 * y en /admin/conversations había que recargar la página.
 */

const uniq = () => `${Date.now()}${Math.floor(Math.random() * 1e6)}`
const URL = 'http://localhost:3333'

async function registrar(client: any, rol: 'cliente' | 'admin' | 'moderador') {
  const res = await client.post('/api/auth/register').json({
    nombre: rol,
    apellido: 'Chat',
    email: `chat_${rol}_${uniq()}@test.com`,
    password: 'Password123',
    rol: 'cliente',
    edad: 30,
  })
  res.assertStatus(200)
  const body = res.body() as { token: string; id: string }
  const id = Number(body.id)
  if (rol === 'admin') await User.query().where('id', id).update({ rol: 'admin' })
  if (rol === 'moderador') {
    await User.query().where('id', id).update({ es_moderador: true, zona_moderador: 'popayan' })
  }
  return { token: body.token, id }
}

/** Conecta un socket y espera a que esté listo. */
function conectar(token: string): Promise<Socket> {
  const socket = io(URL, { transports: ['websocket'], auth: { token: `Bearer ${token}` }, query: { token } })
  return new Promise((resolve, reject) => {
    socket.once('connect', () => resolve(socket))
    socket.once('connect_error', reject)
  })
}

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms))

test.group('Conversatorio en tiempo real', () => {
  test('admin y moderador reciben el mensaje una sola vez', async ({ client, assert }) => {
    const admin = await registrar(client, 'admin')
    const moderador = await registrar(client, 'moderador')
    const cliente = await registrar(client, 'cliente')

    // El moderador abre la conversación con el cliente (queda con ciudad 'popayan').
    const conv = await client
      .post('/api/moderator/conversations')
      .bearerToken(moderador.token)
      .json({ usuarioId: cliente.id, ciudad: 'popayan' })
    conv.assertStatus(200)
    const convId = (conv.body() as { id: number }).id

    const socketAdmin = await conectar(admin.token)
    const socketMod = await conectar(moderador.token)
    const socketCliente = await conectar(cliente.token)

    const recibidos: Record<string, any[]> = { admin: [], moderador: [], cliente: [] }
    socketAdmin.on('conversation:message', (d) => recibidos.admin.push(d))
    socketMod.on('conversation:message', (d) => recibidos.moderador.push(d))
    socketCliente.on('conversation:message', (d) => recibidos.cliente.push(d))

    try {
      const envio = await client
        .post(`/api/moderator/conversations/${convId}/messages`)
        .bearerToken(moderador.token)
        .json({ mensaje: 'Hola, ¿todo bien con el servicio?' })
      envio.assertStatus(200)
      const enviado = envio.body() as { id: number; conversacionId: number; mensaje: string }

      await esperar(700)

      // El admin recibe (regresión corregida) y solo una vez.
      assert.lengthOf(recibidos.admin, 1, `admin recibió ${recibidos.admin.length} eventos`)
      assert.equal(recibidos.admin[0].id, enviado.id)
      assert.equal(String(recibidos.admin[0].conversacionId), String(convId))

      // El moderador que envió también lo recibe una vez (el panel lo concilia por id).
      assert.lengthOf(recibidos.moderador, 1, `moderador recibió ${recibidos.moderador.length} eventos`)

      // El cliente destinatario lo recibe una vez.
      assert.lengthOf(recibidos.cliente, 1, `cliente recibió ${recibidos.cliente.length} eventos`)
      assert.equal(recibidos.cliente[0].mensaje, 'Hola, ¿todo bien con el servicio?')
    } finally {
      socketAdmin.disconnect()
      socketMod.disconnect()
      socketCliente.disconnect()
    }
  })

  test('el mensaje del admin llega al moderador y al cliente', async ({ client, assert }) => {
    const admin = await registrar(client, 'admin')
    const moderador = await registrar(client, 'moderador')
    const cliente = await registrar(client, 'cliente')

    const conv = await client
      .post('/api/moderator/conversations')
      .bearerToken(moderador.token)
      .json({ usuarioId: cliente.id, ciudad: 'popayan' })
    const convId = (conv.body() as { id: number }).id

    const socketMod = await conectar(moderador.token)
    const socketCliente = await conectar(cliente.token)
    const enMod: any[] = []
    const enCliente: any[] = []
    socketMod.on('conversation:message', (d) => enMod.push(d))
    socketCliente.on('conversation:message', (d) => enCliente.push(d))

    try {
      const envio = await client
        .post(`/api/conversations/${convId}/messages`)
        .bearerToken(admin.token)
        .json({ mensaje: 'Soporte central en línea' })
      envio.assertStatus(200)

      await esperar(700)
      assert.lengthOf(enMod, 1)
      assert.lengthOf(enCliente, 1)
      assert.equal(enCliente[0].mensaje, 'Soporte central en línea')
    } finally {
      socketMod.disconnect()
      socketCliente.disconnect()
    }
  })

  test('no se puede escribir en una conversación ajena', async ({ client }) => {
    const moderador = await registrar(client, 'moderador')
    const cliente = await registrar(client, 'cliente')
    const intruso = await registrar(client, 'cliente')

    const conv = await client
      .post('/api/moderator/conversations')
      .bearerToken(moderador.token)
      .json({ usuarioId: cliente.id, ciudad: 'popayan' })
    const convId = (conv.body() as { id: number }).id

    const res = await client
      .post(`/api/conversations/${convId}/messages`)
      .bearerToken(intruso.token)
      .json({ mensaje: 'no debería entrar' })
    res.assertStatus(403)
  })

  test('abrir la conversación dos veces no duplica el hilo', async ({ client, assert }) => {
    const moderador = await registrar(client, 'moderador')
    const cliente = await registrar(client, 'cliente')

    const primera = await client
      .post('/api/moderator/conversations')
      .bearerToken(moderador.token)
      .json({ usuarioId: cliente.id, ciudad: 'popayan' })
    const segunda = await client
      .post('/api/moderator/conversations')
      .bearerToken(moderador.token)
      .json({ usuarioId: cliente.id, ciudad: 'popayan' })

    primera.assertStatus(200)
    segunda.assertStatus(200)
    assert.equal((primera.body() as any).id, (segunda.body() as any).id)
  })
})
