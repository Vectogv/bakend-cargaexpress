import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import { DateTime } from 'luxon'
import ConfiguracionPlataforma from '#models/configuracion_plataforma'
import User from '#models/user'

/** El anuncio se muestra los días que fija gerencia y se baja solo al vencer. */

const uniq = () => `${Date.now()}${Math.floor(Math.random() * 1e6)}`

async function tokenAdmin(client: any) {
  const user = await User.create({
    nombre: 'Test',
    apellido: 'Admin',
    email: `banner_${uniq()}@test.com`,
    password: 'Password123',
    rol: 'admin',
  } as any)
  const login = await client.post('/api/auth/login').json({ email: user.email, password: 'Password123' })
  return login.body().token as string
}

test.group('Banner con límite de días', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('bannerDias fija el vencimiento y 0 lo quita', async ({ client, assert }) => {
    const token = await tokenAdmin(client)
    const res = await client
      .put('/api/admin/config/banner')
      .bearerToken(token)
      .fields({ bannerActivo: 'true', bannerTexto: 'Promo', bannerDias: '3' })
    res.assertStatus(200)
    const hasta = DateTime.fromISO(res.body().bannerHasta)
    assert.closeTo(hasta.diffNow('days').days, 3, 0.01)

    const pub = await client.get('/api/config/banner')
    assert.isTrue(pub.body().activo)
    assert.equal(pub.body().hasta, res.body().bannerHasta)

    const sinLimite = await client
      .put('/api/admin/config/banner')
      .bearerToken(token)
      .fields({ bannerDias: '0' })
    assert.isNull(sinLimite.body().bannerHasta)
  })

  test('vencido, el anuncio público sale inactivo', async ({ client, assert }) => {
    const config = await ConfiguracionPlataforma.unicaOCrear()
    config.bannerActivo = true
    config.bannerTexto = 'Promo'
    config.bannerHasta = DateTime.now().minus({ minutes: 1 })
    await config.save()

    const res = await client.get('/api/config/banner')
    res.assertStatus(200)
    assert.isFalse(res.body().activo)
  })

  test('días inválidos responde 422', async ({ client }) => {
    const token = await tokenAdmin(client)
    const res = await client
      .put('/api/admin/config/banner')
      .bearerToken(token)
      .fields({ bannerDias: '-2' })
    res.assertStatus(422)
  })
})
