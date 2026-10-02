import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import User from '#models/user'

/**
 * Correos en minúsculas, 409 por correo repetido, y el token FCM pertenece a
 * un solo usuario y se borra al cerrar sesión.
 */

const uniq = () => `${Date.now()}${Math.floor(Math.random() * 1e6)}`

const registro = (email: string) => ({
  nombre: 'Cor',
  apellido: 'Reo',
  email,
  password: 'Password123',
  rol: 'cliente',
  edad: 30,
})

test.group('Correo normalizado y FCM', () => {
  test('registro guarda el correo en minúsculas y el login acepta mayúsculas', async ({ client, assert }) => {
    const base = `mayus_${uniq()}@test.com`
    ;(await client.post('/api/auth/register').json(registro(`  ${base.toUpperCase()} `))).assertStatus(200)
    const fila = await db.from('users').where('email', base).first()
    assert.exists(fila)
    const login = await client.post('/api/auth/login').json({ email: base.toUpperCase(), password: 'Password123' })
    login.assertStatus(200)
  })

  test('correo repetido (aun con otras mayúsculas): 409 con mensaje claro', async ({ client }) => {
    const base = `dupmail_${uniq()}@test.com`
    ;(await client.post('/api/auth/register').json(registro(base))).assertStatus(200)
    const res = await client.post('/api/auth/register').json(registro(base.toUpperCase()))
    res.assertStatus(409)
    res.assertBodyContains({ message: 'Ese correo ya está registrado.' })
  })

  test('logout borra el fcm_token; updateFcmToken se lo quita a otro usuario', async ({ client, assert }) => {
    const a = await client.post('/api/auth/register').json(registro(`fcma_${uniq()}@test.com`))
    const b = await client.post('/api/auth/register').json(registro(`fcmb_${uniq()}@test.com`))
    const token = `tok_${uniq()}`
    ;(await client.put('/api/users/fcm-token').bearerToken(a.body().token).json({ fcmToken: token })).assertStatus(200)
    ;(await client.put('/api/users/fcm-token').bearerToken(b.body().token).json({ fcmToken: token })).assertStatus(200)
    assert.isNull((await User.findOrFail(Number(a.body().id))).fcmToken)
    assert.equal((await User.findOrFail(Number(b.body().id))).fcmToken, token)

    ;(await client.post('/api/auth/logout').bearerToken(b.body().token)).assertStatus(200)
    assert.isNull((await User.findOrFail(Number(b.body().id))).fcmToken)
  })
})
