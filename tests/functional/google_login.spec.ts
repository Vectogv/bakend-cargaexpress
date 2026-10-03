import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import User from '#models/user'

/**
 * POST /api/auth/google: Google (tokeninfo) se simula con `fetch`, no hay red.
 */

const AUD = '848686850284-bi6477mo5t1ok3tgrha0vvnfmqcdcfma.apps.googleusercontent.com'
const TOKEN = 'x'.repeat(40)
const uniq = () => `${Date.now()}${Math.floor(Math.random() * 1e6)}`

function simularGoogle(info: any, status = 200) {
  const original = globalThis.fetch
  globalThis.fetch = (async () => new Response(JSON.stringify(info), { status })) as typeof fetch
  return () => {
    globalThis.fetch = original
  }
}

test.group('Entrar con Google', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('correo nuevo: 404 CUENTA_NO_EXISTE con datos de Google y no crea usuario', async ({ client, assert }) => {
    const email = `google_${uniq()}@gmail.com`
    const restaurar = simularGoogle({
      aud: AUD, email, email_verified: 'true', given_name: 'Ana', family_name: 'Pérez', picture: 'http://f/x.png',
    })
    const res = await client.post('/api/auth/google').json({ idToken: TOKEN })
    restaurar()
    res.assertStatus(404)
    assert.equal(res.body().code, 'CUENTA_NO_EXISTE')
    assert.deepEqual(res.body().google, { nombre: 'Ana', apellido: 'Pérez', email, foto: 'http://f/x.png' })
    assert.isNull(await User.findBy('email', email))
  })

  test('correo existente: entra a esa cuenta sin crear otra', async ({ client, assert }) => {
    const email = `existe_${uniq()}@gmail.com`
    const reg = await client
      .post('/api/auth/register')
      .json({ nombre: 'Luis', apellido: 'Gómez', email, password: 'Clave1234', rol: 'cliente', edad: 30 })
    const restaurar = simularGoogle({ aud: AUD, email, email_verified: 'true' })
    const res = await client.post('/api/auth/google').json({ idToken: TOKEN })
    restaurar()
    res.assertStatus(200)
    assert.equal(res.body().id, reg.body().id)
    assert.isFalse(res.body().cuentaNueva)
    // Tiene edad pero no teléfono ni registro cerrado: la app lo manda al asistente.
    assert.isFalse(res.body().perfilCompleto)

    await client
      .put('/api/users/profile')
      .bearerToken(reg.body().token)
      .json({ telefono: '3001234567', aceptaTerminos: true })
    const restaurar2 = simularGoogle({ aud: AUD, email, email_verified: 'true' })
    const res2 = await client.post('/api/auth/google').json({ idToken: TOKEN })
    restaurar2()
    assert.isTrue(res2.body().perfilCompleto)
  })

  test('rechaza token de otra app, correo sin verificar o inválido', async ({ client }) => {
    const casos: [any, number][] = [
      [{ aud: 'otra.apps.googleusercontent.com', email: 'a@gmail.com', email_verified: 'true' }, 200],
      [{ aud: AUD, email: 'a@gmail.com', email_verified: 'false' }, 200],
      [{ error: 'invalid_token' }, 400],
    ]
    for (const [info, status] of casos) {
      const restaurar = simularGoogle(info, status)
      const res = await client.post('/api/auth/google').json({ idToken: TOKEN })
      restaurar()
      res.assertStatus(401)
    }
  })

  test('cuenta suspendida: 403', async ({ client }) => {
    const email = `susp_${uniq()}@gmail.com`
    const reg = await client
      .post('/api/auth/register')
      .json({ nombre: 'Sol', apellido: 'Rey', email, password: 'Clave1234', rol: 'cliente', edad: 30 })
    await User.query().where('id', Number(reg.body().id)).update({ suspendido: true })
    const restaurar = simularGoogle({ aud: AUD, email, email_verified: 'true' })
    const res = await client.post('/api/auth/google').json({ idToken: TOKEN })
    restaurar()
    res.assertStatus(403)
  })
})
