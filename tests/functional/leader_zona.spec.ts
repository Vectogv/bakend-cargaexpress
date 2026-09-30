import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import Aviso from '#models/aviso'
import Comunicado from '#models/comunicado'
import Conductor from '#models/conductor'
import User from '#models/user'

/**
 * La zona de los avisos y comunicados del líder sale de la ciudad de su
 * perfil de conductor (normalizada), no de zonaModerador (vacía en un líder).
 */

const uniq = () => `${Date.now()}${Math.floor(Math.random() * 1e6)}`

async function registrarLider(client: any, ciudad: string | null) {
  const res = await client.post('/api/auth/register').json({
    nombre: 'Lid',
    apellido: 'Zona',
    email: `lider_${uniq()}@test.com`,
    password: 'Password123',
    rol: 'conductor',
    edad: 35,
    cedula: `${uniq()}`.slice(-10),
    placa: `LDR${`${uniq()}`.slice(-4)}`,
    tipoVehiculo: 'camioneta',
    capacidad: '1 tonelada',
    ciudad,
  })
  res.assertStatus(200)
  const id = Number(res.body().id)
  await User.query().where('id', id).update({ es_lider: true })
  const login = await client
    .post('/api/auth/login')
    .json({ email: res.body().email, password: 'Password123' })
  return { id, token: login.body().token as string }
}

test.group('Zona del líder', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('aviso y comunicado quedan en la ciudad normalizada del conductor', async ({ client, assert }) => {
    const lider = await registrarLider(client, 'Popayán')

    const aviso = await client
      .post('/api/leader/avisos')
      .bearerToken(lider.token)
      .json({ contenido: 'Reunión el viernes' })
    aviso.assertStatus(200)
    assert.equal((await Aviso.findOrFail(aviso.body().id)).zona, 'popayan')

    const comunicado = await client
      .post('/api/leader/comunicados')
      .bearerToken(lider.token)
      .json({ titulo: 'Aviso', contenido: 'Cambio de horario' })
    comunicado.assertStatus(200)
    assert.equal((await Comunicado.findOrFail(comunicado.body().id)).zona, 'popayan')
  })

  test('líder sin ciudad en su perfil de conductor: 403', async ({ client }) => {
    const lider = await registrarLider(client, null)
    const aviso = await client
      .post('/api/leader/avisos')
      .bearerToken(lider.token)
      .json({ contenido: 'x' })
    aviso.assertStatus(403)
    aviso.assertBodyContains({ error: 'Tu perfil de conductor no tiene ciudad asignada' })

    const comunicado = await client
      .post('/api/leader/comunicados')
      .bearerToken(lider.token)
      .json({ titulo: 't', contenido: 'c' })
    comunicado.assertStatus(403)

    // Sin perfil de conductor (fila borrada) también 403.
    await Conductor.query().where('usuario_id', lider.id).delete()
    const sinConductor = await client
      .post('/api/leader/avisos')
      .bearerToken(lider.token)
      .json({ contenido: 'x' })
    sinConductor.assertStatus(403)
  })
})
