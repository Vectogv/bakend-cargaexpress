import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import User from '#models/user'
import Comunicado from '#models/comunicado'
import Encuesta from '#models/encuesta'
import { tokensConductoresDeZona } from '#controllers/admin_controller'

test.group('Admin - listar comunicados y encuestas', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  async function registerAndGetToken(client: any, rol: string = 'cliente') {
    if (rol === 'admin') {
      const admin = await User.create({
        nombre: 'Admin',
        apellido: 'Token',
        email: `admin-token-${Date.now()}@test.com`,
        password: '123456',
        rol: 'admin', edad: 30,
      })
      const login = await client.post('/api/auth/login').json({
        email: admin.email,
        password: '123456',
      })
      return login.body().token
    }
    const res = await client.post('/api/auth/register').json({
      nombre: 'Test',
      apellido: 'User',
      email: `test-content-${rol}-${Date.now()}@test.com`,
      password: '123456',
      rol,
      edad: 30,
    })
    return res.body().token
  }

  test('admin puede listar comunicados con el formato esperado por Flutter', async ({ client, assert }) => {
    const admin = await User.create({
      nombre: 'Admin',
      apellido: 'Principal',
      email: `admin-content-${Date.now()}@test.com`,
      password: '123456',
      rol: 'admin',
    })
    await Comunicado.create({
      moderadorId: admin.id,
      zona: 'Norte',
      titulo: 'Actualizacion de tarifas',
      contenido: 'Las tarifas cambian el proximo mes',
      estado: 'pendiente',
    })
    await Comunicado.create({
      moderadorId: admin.id,
      zona: 'Sur',
      titulo: 'Nueva zona de cobertura',
      contenido: 'Ampliamos cobertura',
      estado: 'aprobado',
    })
    await Comunicado.create({
      moderadorId: admin.id,
      zona: 'Centro',
      titulo: 'Mantenimiento',
      contenido: 'Sistema en mantenimiento',
      estado: 'rechazado',
    })

    const token = await registerAndGetToken(client, 'admin')
    const response = await client.get('/api/admin/comunicados').bearerToken(token)

    response.assertStatus(200)
    const body = response.body()
    assert.isArray(body)
    assert.equal(body.length, 3)

    const pendiente = body.find((c: any) => c.title === 'Actualizacion de tarifas')
    assert.isDefined(pendiente)
    assert.equal(pendiente.status, 'pending')
    assert.equal(pendiente.body, 'Las tarifas cambian el proximo mes')
    assert.equal(pendiente.author, 'Admin Principal')
    assert.equal(pendiente.zona, 'Norte')
    assert.isDefined(pendiente.createdAt)

    const aprobado = body.find((c: any) => c.title === 'Nueva zona de cobertura')
    assert.equal(aprobado.status, 'approved')

    const rechazado = body.find((c: any) => c.title === 'Mantenimiento')
    assert.equal(rechazado.status, 'rejected')
  })

  test('admin puede listar encuestas con el formato esperado por Flutter', async ({ client, assert }) => {
    const admin = await User.create({
      nombre: 'Admin',
      apellido: 'Encuestas',
      email: `admin-enc-${Date.now()}@test.com`,
      password: '123456',
      rol: 'admin',
    })
    await Encuesta.create({
      moderadorId: admin.id,
      zona: 'Norte',
      pregunta: 'Que tan satisfecho estas con el servicio?',
      opciones: JSON.stringify(['Muy bien', 'Bien', 'Regular', 'Mal']),
      estado: 'pendiente',
    })
    await Encuesta.create({
      moderadorId: admin.id,
      zona: 'Sur',
      pregunta: 'Evaluacion de conductores',
      opciones: JSON.stringify(['1', '2', '3', '4', '5']),
      estado: 'activa',
    })

    const token = await registerAndGetToken(client, 'admin')
    const response = await client.get('/api/admin/encuestas').bearerToken(token)

    response.assertStatus(200)
    const body = response.body()
    assert.isArray(body)
    assert.equal(body.length, 2)

    const pendiente = body.find((e: any) => e.title === 'Que tan satisfecho estas con el servicio?')
    assert.isDefined(pendiente)
    assert.equal(pendiente.status, 'pendiente')
    assert.equal(pendiente.author, 'Admin Encuestas')
    assert.isDefined(pendiente.date)

    const activa = body.find((e: any) => e.title === 'Evaluacion de conductores')
    assert.equal(activa.status, 'aprobada')
  })

  test('el push de un comunicado aprobado va solo a los conductores de su zona', async ({
    client,
    assert,
  }) => {
    const u = `${Date.now()}${Math.floor(Math.random() * 1e6)}`
    const conductor = (ciudad: string, placa: string) =>
      client.post('/api/auth/register').json({
        nombre: 'Zona',
        apellido: 'Prueba',
        email: `zona_${placa}_${u}@test.com`,
        password: 'Password123',
        rol: 'conductor',
        edad: 30,
        cedula: `10${Math.floor(Math.random() * 1e8)}`,
        placa,
        tipoVehiculo: 'Turbo',
        capacidad: '1 tonelada',
        ciudad,
      })
    const pop = await conductor('Popayán', `ZPA${Math.floor(Math.random() * 900) + 100}`)
    const cali = await conductor('cali', `ZCA${Math.floor(Math.random() * 900) + 100}`)
    const cliente = await client.post('/api/auth/register').json({
      nombre: 'Cli', apellido: 'Ente', email: `zona_cli_${u}@test.com`, password: 'Password123', rol: 'cliente', edad: 30,
    })
    await User.query().where('id', Number(pop.body().id)).update({ fcm_token: `tok_pop_${u}` })
    await User.query().where('id', Number(cali.body().id)).update({ fcm_token: `tok_cali_${u}` })
    await User.query().where('id', Number(cliente.body().id)).update({ fcm_token: `tok_cli_${u}` })

    const tokens = await tokensConductoresDeZona('popayan')
    assert.include(tokens, `tok_pop_${u}`)
    assert.notInclude(tokens, `tok_cali_${u}`)
    assert.notInclude(tokens, `tok_cli_${u}`)
  })

  test('un usuario sin rol admin recibe 403', async ({ client }) => {
    const token = await registerAndGetToken(client, 'cliente')

    const resComunicados = await client.get('/api/admin/comunicados').bearerToken(token)
    resComunicados.assertStatus(403)

    const resEncuestas = await client.get('/api/admin/encuestas').bearerToken(token)
    resEncuestas.assertStatus(403)
  })

  test('acceso sin autenticacion recibe 401', async ({ client }) => {
    const resComunicados = await client.get('/api/admin/comunicados')
    resComunicados.assertStatus(401)

    const resEncuestas = await client.get('/api/admin/encuestas')
    resEncuestas.assertStatus(401)
  })
})