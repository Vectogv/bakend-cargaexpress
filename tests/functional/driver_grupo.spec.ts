import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import Aviso from '#models/aviso'
import Comunicado from '#models/comunicado'
import User from '#models/user'
import { DateTime } from 'luxon'

/**
 * GET /api/drivers/grupo: zona del conductor, líder de la zona (users.es_lider
 * con la misma ciudad normalizada), avisos (fijados primero) y comunicados
 * aprobados de la zona.
 */

const uniq = () => `${Date.now()}${Math.floor(Math.random() * 1e6)}`

async function registrarConductor(client: any, ciudad: string | null, extra: Record<string, any> = {}) {
  const res = await client.post('/api/auth/register').json({
    nombre: 'Con',
    apellido: 'Grupo',
    email: `grupo_${uniq()}@test.com`,
    password: 'Password123',
    rol: 'conductor',
    edad: 35,
    cedula: `${uniq()}`.slice(-10),
    placa: `GRP${`${uniq()}`.slice(-4)}`,
    tipoVehiculo: 'camioneta',
    capacidad: '1 tonelada',
    ciudad,
    ...extra,
  })
  res.assertStatus(200)
  return { id: Number(res.body().id), token: res.body().token as string }
}

test.group('GET /api/drivers/grupo', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('trae zona, líder, avisos ordenados y comunicados aprobados', async ({ client, assert }) => {
    const lider = await registrarConductor(client, 'Popayán', { nombre: 'Luis', apellido: 'Líder', telefono: '3001112233' })
    await User.query().where('id', lider.id).update({ es_lider: true })
    const conductor = await registrarConductor(client, 'popayan')
    // Líder de otra ciudad: no cuenta.
    const otro = await registrarConductor(client, 'Cali')
    await User.query().where('id', otro.id).update({ es_lider: true })

    const hace = (min: number) => DateTime.now().minus({ minutes: min })
    const viejo = await Aviso.create({ autorId: lider.id, zona: 'popayan', contenido: 'viejo', fijado: false, createdAt: hace(3) })
    const fijado = await Aviso.create({ autorId: lider.id, zona: 'popayan', contenido: 'fijado', fijado: true, createdAt: hace(4) })
    const nuevo = await Aviso.create({ autorId: conductor.id, zona: 'general', contenido: 'nuevo', fijado: false, createdAt: hace(1) })
    await Aviso.create({ autorId: otro.id, zona: 'cali', contenido: 'de cali', fijado: true })
    await Aviso.create({ autorId: lider.id, zona: 'popayan', contenido: 'borrado', fijado: false, eliminado: true })

    const aprobado = await Comunicado.create({
      moderadorId: lider.id, zona: 'popayan', titulo: 'Ok', contenido: 'aprobado', estado: 'aprobado',
    })
    await Comunicado.create({
      moderadorId: lider.id, zona: 'popayan', titulo: 'No', contenido: 'pendiente', estado: 'pendiente',
    })

    const res = await client.get('/api/drivers/grupo').bearerToken(conductor.token)
    res.assertStatus(200)
    const body = res.body()
    assert.equal(body.zona, 'popayan')
    assert.isFalse(body.esLider)
    assert.deepEqual(body.lider, { id: lider.id, nombre: 'Luis Líder', telefono: '3001112233' })
    // Fijado primero; luego del más nuevo al más viejo (el 'general' del conductor cuenta).
    assert.deepEqual(
      body.avisos.map((a: any) => a.id),
      [fijado.id, nuevo.id, viejo.id]
    )
    assert.deepEqual(body.avisos[0].autor, { nombre: 'Luis', apellido: 'Líder', rol: 'conductor' })
    assert.isTrue(body.avisos[0].fijado)
    assert.deepEqual(body.comunicados.map((c: any) => c.id), [aprobado.id])
    assert.equal(body.comunicados[0].titulo, 'Ok')

    const comoLider = await client.get('/api/drivers/grupo').bearerToken(lider.token)
    assert.isTrue(comoLider.body().esLider)
    assert.equal(comoLider.body().zona, 'Popayán')
  })

  test('sin ciudad: zona null y listas vacías; cliente: 403', async ({ client, assert }) => {
    const sinCiudad = await registrarConductor(client, null)
    const res = await client.get('/api/drivers/grupo').bearerToken(sinCiudad.token)
    res.assertStatus(200)
    assert.deepEqual(res.body(), { zona: null, esLider: false, lider: null, avisos: [], comunicados: [] })

    const cliente = await client.post('/api/auth/register').json({
      nombre: 'Cli', apellido: 'X', email: `cli_grupo_${uniq()}@test.com`,
      password: 'Password123', rol: 'cliente', edad: 30,
    })
    const prohibido = await client.get('/api/drivers/grupo').bearerToken(cliente.body().token)
    prohibido.assertStatus(403)
  })
})
