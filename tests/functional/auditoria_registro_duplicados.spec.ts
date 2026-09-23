import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'

/**
 * Auditoría IMPORTANTE #6: registrar un conductor con placa o cédula ya
 * registradas respondía 500 y dejaba un usuario huérfano sin perfil de
 * conductor. Debe responder 409 con un mensaje claro y no crear nada.
 */

const uniq = () => `${Date.now()}${Math.floor(Math.random() * 1e6)}`

function conductor(overrides: Record<string, unknown> = {}) {
  return {
    nombre: 'Dup',
    apellido: 'Registro',
    email: `dup_${uniq()}@test.com`,
    password: 'Password123',
    rol: 'conductor',
    edad: 30,
    cedula: `${uniq()}`.slice(-10),
    placa: `DUP${`${uniq()}`.slice(-5)}`,
    tipoVehiculo: 'camioneta',
    capacidad: '1 tonelada',
    ciudad: 'popayan',
    ...overrides,
  }
}

test.group('Auditoría #6 - registro con placa/cédula duplicada', () => {
  test('placa duplicada: 409 PLACA_DUPLICADA y sin usuario huérfano', async ({ client, assert }) => {
    const primero = conductor()
    ;(await client.post('/api/auth/register').json(primero)).assertStatus(200)

    const segundo = conductor({ placa: primero.placa })
    const res = await client.post('/api/auth/register').json(segundo)
    res.assertStatus(409)
    res.assertBodyContains({ code: 'PLACA_DUPLICADA' })

    const huerfano = await db.from('users').where('email', segundo.email).first()
    assert.isNull(huerfano ?? null)
  })

  test('cédula duplicada: 409 CEDULA_DUPLICADA y sin usuario huérfano', async ({ client, assert }) => {
    const primero = conductor()
    ;(await client.post('/api/auth/register').json(primero)).assertStatus(200)

    const segundo = conductor({ cedula: primero.cedula })
    const res = await client.post('/api/auth/register').json(segundo)
    res.assertStatus(409)
    res.assertBodyContains({ code: 'CEDULA_DUPLICADA' })

    const huerfano = await db.from('users').where('email', segundo.email).first()
    assert.isNull(huerfano ?? null)
  })

  test('registros simultáneos con la misma placa: uno gana y no quedan huérfanos', async ({
    client,
    assert,
  }) => {
    const placa = `SIM${`${uniq()}`.slice(-5)}`
    const a = conductor({ placa })
    const b = conductor({ placa })
    const [ra, rb] = await Promise.all([
      client.post('/api/auth/register').json(a),
      client.post('/api/auth/register').json(b),
    ])
    assert.deepEqual([ra.status(), rb.status()].sort(), [200, 409])

    const usuarios = await db.from('users').whereIn('email', [a.email, b.email])
    assert.lengthOf(usuarios, 1)
    const perfil = await db.from('conductores').where('usuario_id', usuarios[0].id).first()
    assert.isNotNull(perfil)
  })
})
