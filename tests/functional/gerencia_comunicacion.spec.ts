import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import Aviso from '#models/aviso'
import Comunicado from '#models/comunicado'
import Notificacion from '#models/notificacion'
import User from '#models/user'
import db from '@adonisjs/lucid/services/db'

const uniq = () => `${Date.now()}${Math.floor(Math.random() * 1e6)}`

const ZA = `Za${uniq()}`
const ZB = `Zb${uniq()}`

async function conductor(client: any, ciudad: string) {
  const res = await client.post('/api/auth/register').json({
    nombre: 'Con', apellido: 'Ger', email: `ger_${uniq()}@test.com`, password: 'Password123',
    rol: 'conductor', edad: 35, cedula: `${uniq()}`.slice(-10), placa: `GER${`${uniq()}`.slice(-4)}`,
    tipoVehiculo: 'camioneta', capacidad: '1 tonelada', ciudad,
  })
  res.assertStatus(200)
  return { id: Number(res.body().id), token: res.body().token as string }
}

async function admin(client: any) {
  const a = await User.create({ nombre: 'Ad', apellido: 'Min', email: `adm_${uniq()}@test.com`, password: '123456', rol: 'admin', edad: 30 })
  const login = await client.post('/api/auth/login').json({ email: a.email, password: '123456' })
  return { id: a.id, token: login.body().token as string }
}

test.group('Gerencia: comunicación y pendientes', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('comunicación a conductores de una zona: aviso, bandeja y sin tocar otras zonas', async ({ client, assert }) => {
    const ad = await admin(client)
    const pop = await conductor(client, ZA)
    const cali = await conductor(client, ZB)
    const res = await client.post('/api/admin/comunicacion').bearerToken(ad.token)
      .json({ titulo: 'Reunión', mensaje: 'Mañana 8am', destino: 'conductores', zona: ZA })
    res.assertStatus(200)
    assert.equal(res.body().destinatarios, 1)
    const aviso = await Aviso.query().where('autor_id', ad.id).firstOrFail()
    assert.equal(aviso.zona, ZA.toLowerCase())
    assert.include(aviso.contenido, 'Mañana 8am')
    assert.equal((await Notificacion.query().where('usuario_id', pop.id)).length, 1)
    assert.equal((await Notificacion.query().where('usuario_id', cali.id)).length, 0)
    // El conductor la ve en su grupo.
    const grupo = await client.get('/api/drivers/grupo').bearerToken(pop.token)
    assert.equal(grupo.body().avisos.length, 1)
  })

  test('sin zona va a todos (aviso general) y a moderadores solo bandeja', async ({ client, assert }) => {
    const ad = await admin(client)
    const c1 = await conductor(client, ZA)
    const c2 = await conductor(client, ZB)
    const r = await client.post('/api/admin/comunicacion').bearerToken(ad.token)
      .json({ titulo: 'Todos', mensaje: 'Hola', destino: 'conductores' })
    assert.isAtLeast(r.body().destinatarios, 2)
    assert.equal((await Aviso.query().where('zona', 'general').where('autor_id', ad.id)).length, 1)
    assert.isAbove((await Notificacion.query().whereIn('usuario_id', [c1.id, c2.id])).length, 1)

    const mod = await User.create({ nombre: 'Mo', apellido: 'D', email: `mod_${uniq()}@test.com`, password: '123456', rol: 'cliente', edad: 30 })
    await User.query().where('id', mod.id).update({ es_moderador: true, zona_moderador: ZA })
    const m = await client.post('/api/admin/comunicacion').bearerToken(ad.token)
      .json({ titulo: 'Mod', mensaje: 'Revisen', destino: 'moderadores', zona: ZA })
    assert.equal(m.body().destinatarios, 1)
    assert.equal((await Notificacion.query().where('usuario_id', mod.id)).length, 1)
  })

  test('valida el cuerpo y exige admin', async ({ client }) => {
    const ad = await admin(client)
    const c = await conductor(client, ZA)
    ;(await client.post('/api/admin/comunicacion').bearerToken(ad.token).json({ titulo: '', mensaje: 'x', destino: 'conductores' })).assertStatus(422)
    ;(await client.post('/api/admin/comunicacion').bearerToken(ad.token).json({ titulo: 'x', mensaje: 'x', destino: 'otros' })).assertStatus(422)
    ;(await client.post('/api/admin/comunicacion').bearerToken(c.token).json({ titulo: 'x', mensaje: 'x', destino: 'conductores' })).assertStatus(403)
    ;(await client.get('/api/admin/pendientes').bearerToken(c.token)).assertStatus(403)
  })

  test('pendientes cuenta por categoría y zona, y filtra por zona', async ({ client, assert }) => {
    const ad = await admin(client)
    await conductor(client, ZA) // verificación pendiente por defecto
    await conductor(client, ZB)
    await Comunicado.create({ moderadorId: ad.id, zona: ZA.toLowerCase(), titulo: 'Inq', contenido: 'x', estado: 'pendiente' })
    await Comunicado.create({ moderadorId: ad.id, zona: ZA.toLowerCase(), titulo: 'Ya', contenido: 'x', estado: 'aprobado' })
    await db.table('tickets_soporte').insert({
      usuario_id: ad.id, categoria: 'otro', asunto: 'Ayuda', descripcion: 'x', estado: 'abierto', zona: ZA.toLowerCase(),
      created_at: new Date(), updated_at: new Date(),
    })

    const res = await client.get('/api/admin/pendientes?zona=' + ZA).bearerToken(ad.token)
    res.assertStatus(200)
    const por = (b: any, k: string) => b.categorias.find((c: any) => c.clave === k)
    const b = res.body()
    assert.deepEqual(por(b, 'verificaciones').porZona, { [ZA.toLowerCase()]: 1 })
    assert.equal(por(b, 'comunicados').total, 1)
    assert.equal(por(b, 'tickets').total, 1)
    assert.equal(por(b, 'disputas').total, 0)
    assert.equal(b.total, 3)

    const f = await client.get('/api/admin/pendientes?zona=' + ZB).bearerToken(ad.token)
    assert.equal(por(f.body(), 'verificaciones').total, 1)
    assert.equal(por(f.body(), 'comunicados').total, 0)
  })
})
