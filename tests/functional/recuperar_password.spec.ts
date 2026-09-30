import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import env from '#start/env'
import User from '#models/user'
import CodigoRecuperacion from '#models/codigo_recuperacion'
import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'

/**
 * Recuperar contraseña por correo: POST /api/auth/forgot-password manda un
 * código de 6 dígitos por Brevo (aquí `fetch` se simula, no hay red) y
 * POST /api/auth/reset-password lo canjea por una contraseña nueva.
 */

const uniq = () => `${Date.now()}${Math.floor(Math.random() * 1e6)}`

/** Simula Brevo: captura el cuerpo enviado y devuelve el código del HTML. */
function simularBrevo() {
  const envios: any[] = []
  const original = globalThis.fetch
  globalThis.fetch = (async (_url: any, init: any) => {
    envios.push(JSON.parse(init.body))
    return new Response('{"messageId":"x"}', { status: 201 })
  }) as typeof fetch
  return {
    envios,
    codigo: () => envios.at(-1).htmlContent.match(/(\d{6})/)![1] as string,
    restaurar: () => {
      globalThis.fetch = original
    },
  }
}

async function registrar(client: any) {
  const email = `recupera_${uniq()}@test.com`
  const res = await client
    .post('/api/auth/register')
    .json({ nombre: 'Ana', apellido: 'Olvido', email, password: 'Vieja1234', rol: 'cliente', edad: 30 })
  res.assertStatus(200)
  return { email, id: Number(res.body().id), token: res.body().token as string }
}

test.group('Recuperar contraseña por correo', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())
  let brevo: ReturnType<typeof simularBrevo>
  group.each.setup(() => {
    env.set('BREVO_API_KEY', 'test-key')
    brevo = simularBrevo()
    return () => brevo.restaurar()
  })

  test('manda el código por Brevo y sirve para cambiar la contraseña', async ({ client, assert }) => {
    const { email, token } = await registrar(client)

    const forgot = await client.post('/api/auth/forgot-password').json({ email })
    forgot.assertStatus(200)
    forgot.assertBodyContains({ message: 'Si el correo está registrado, te enviamos un código' })

    assert.lengthOf(brevo.envios, 1)
    assert.equal(brevo.envios[0].to[0].email, email)
    const codigo = brevo.codigo()
    // En la BD solo queda el hash, nunca el código.
    const guardado = await CodigoRecuperacion.query().orderBy('id', 'desc').firstOrFail()
    assert.notEqual(guardado.codigoHash, codigo)
    assert.lengthOf(guardado.codigoHash, 64)

    const reset = await client
      .post('/api/auth/reset-password')
      .json({ email, codigo, password: 'Nueva12345' })
    reset.assertStatus(200)

    // La sesión vieja quedó revocada y la contraseña nueva funciona.
    const viejo = await client.get('/api/users/profile').header('Authorization', `Bearer ${token}`)
    viejo.assertStatus(401)
    const login = await client.post('/api/auth/login').json({ email, password: 'Nueva12345' })
    login.assertStatus(200)

    // El código ya no se puede reutilizar.
    const otra = await client
      .post('/api/auth/reset-password')
      .json({ email, codigo, password: 'Nueva12345' })
    otra.assertStatus(400)
    otra.assertBodyContains({ message: 'Código inválido o vencido' })
  })

  test('correo no registrado: mismo 200 y no se envía nada; formato inválido: 422', async ({
    client,
    assert,
  }) => {
    const res = await client.post('/api/auth/forgot-password').json({ email: `nadie_${uniq()}@test.com` })
    res.assertStatus(200)
    assert.lengthOf(brevo.envios, 0)

    const malo = await client.post('/api/auth/forgot-password').json({ email: 'no-es-correo' })
    malo.assertStatus(422)
  })

  test('si Brevo falla igual responde 200', async ({ client }) => {
    const { email } = await registrar(client)
    globalThis.fetch = (async () => {
      throw new Error('red caída')
    }) as typeof fetch
    const res = await client.post('/api/auth/forgot-password').json({ email })
    res.assertStatus(200)
  })

  test('código equivocado 5 veces lo invalida; el correcto ya no sirve', async ({ client }) => {
    const { email } = await registrar(client)
    await client.post('/api/auth/forgot-password').json({ email })
    const codigo = brevo.codigo()
    const equivocado = codigo === '000000' ? '111111' : '000000'

    for (let i = 0; i < 5; i++) {
      const res = await client
        .post('/api/auth/reset-password')
        .json({ email, codigo: equivocado, password: 'Nueva12345' })
      res.assertStatus(400)
    }
    const bueno = await client
      .post('/api/auth/reset-password')
      .json({ email, codigo, password: 'Nueva12345' })
    bueno.assertStatus(400)
  })

  test('código vencido: 400; pedir otro invalida el anterior; password corta: 422', async ({
    client,
  }) => {
    const { email, id } = await registrar(client)
    await client.post('/api/auth/forgot-password').json({ email })
    const primero = brevo.codigo()
    await db
      .from('codigos_recuperacion')
      .where('user_id', id)
      .update({ expira_at: DateTime.now().minus({ minutes: 1 }).toSQL() })
    const vencido = await client
      .post('/api/auth/reset-password')
      .json({ email, codigo: primero, password: 'Nueva12345' })
    vencido.assertStatus(400)

    await client.post('/api/auth/forgot-password').json({ email })
    await client.post('/api/auth/forgot-password').json({ email })
    const segundo = brevo.envios.at(-2).htmlContent.match(/(\d{6})/)![1]
    const tercero = brevo.codigo()
    if (segundo !== tercero) {
      const viejo = await client
        .post('/api/auth/reset-password')
        .json({ email, codigo: segundo, password: 'Nueva12345' })
      viejo.assertStatus(400)
    }

    const corta = await client
      .post('/api/auth/reset-password')
      .json({ email, codigo: tercero, password: 'corta' })
    corta.assertStatus(422)

    const ok = await client
      .post('/api/auth/reset-password')
      .json({ email, codigo: tercero, password: 'Nueva12345' })
    ok.assertStatus(200)
    const user = await User.findOrFail(id)
    const login = await client.post('/api/auth/login').json({ email: user.email, password: 'Nueva12345' })
    login.assertStatus(200)
  })
})
