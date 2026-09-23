import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import ConfiguracionPlataforma from '#models/configuracion_plataforma'
import User from '#models/user'
import CoverageService from '#services/coverage_service'

const uniq = () => `${Date.now()}${Math.floor(Math.random() * 1e6)}`

const POPAYAN = { nombre: 'Popayán', activa: true, norte: 2.5, sur: 2.4, este: -76.55, oeste: -76.66 }

async function tokenDe(client: any, rol: 'cliente' | 'admin') {
  const email = `zona_${rol}_${uniq()}@test.com`
  const res = await client.post('/api/auth/register').json({
    nombre: 'Zona',
    apellido: 'Test',
    email,
    password: 'Password123',
    rol: 'cliente',
    edad: 30,
  })
  const body = res.body() as { token: string; id: string }
  if (rol === 'admin') {
    await User.query().where('id', Number(body.id)).update({ rol: 'admin' })
  }
  return body.token
}

const viaje = (lat: number, lng: number) => ({
  origen: { direccion: 'Origen', lat, lng },
  destino: { direccion: 'Destino', lat: lat + 0.02, lng: lng + 0.02 },
  descripcion: 'carga',
  precioCliente: 50000,
})

test.group('Cobertura por zonas', (group) => {
  group.each.setup(async () => {
    await ConfiguracionPlataforma.query().delete()
  })

  test('el admin guarda zonas y se leen igual (columna JSON en cualquier motor)', async ({ client, assert }) => {
    const token = await tokenDe(client, 'admin')

    const guardar = await client.put('/api/admin/config/coverage').bearerToken(token).json({ zonasCobertura: [POPAYAN] })
    guardar.assertStatus(200)

    // Regresión: la columna JSON se guardaba como objeto y SQLite fallaba con 500.
    const zonas = await CoverageService.zonas()
    assert.lengthOf(zonas, 1)
    assert.equal(zonas[0].clave, 'popayan')
    assert.isTrue(zonas[0].activa)

    const publicas = await client.get('/api/config/coverage')
    publicas.assertStatus(200)
    assert.equal((publicas.body() as any).zonas[0].nombre, 'Popayán')
  })

  test('solo se aceptan viajes dentro de una zona activa', async ({ client }) => {
    const admin = await tokenDe(client, 'admin')
    await client.put('/api/admin/config/coverage').bearerToken(admin).json({ zonasCobertura: [POPAYAN] })

    const fuera = await client.post('/api/trips/request').bearerToken(await tokenDe(client, 'cliente')).json(viaje(4.65, -74.05))
    fuera.assertStatus(422)
    fuera.assertBodyContains({ error: 'Lo sentimos, por el momento solo operamos en Popayán.' })

    const dentro = await client.post('/api/trips/request').bearerToken(await tokenDe(client, 'cliente')).json(viaje(2.44, -76.61))
    dentro.assertStatus(200)
  })

  test('rechaza viajes y reservas con destino fuera de cobertura', async ({ client }) => {
    const admin = await tokenDe(client, 'admin')
    await client
      .put('/api/admin/config/coverage')
      .bearerToken(admin)
      .json({ zonasCobertura: [POPAYAN] })

    const destinoFuera = {
      ...viaje(2.44, -76.61),
      destino: { direccion: 'Bogotá', lat: 4.65, lng: -74.05 },
    }
    const mensaje =
      'El destino está fuera de nuestra zona de cobertura. Lo sentimos, por el momento solo operamos en Popayán.'

    const pedido = await client
      .post('/api/trips/request')
      .bearerToken(await tokenDe(client, 'cliente'))
      .json(destinoFuera)
    pedido.assertStatus(422)
    pedido.assertBodyContains({ error: mensaje })

    const reserva = await client
      .post('/api/trips/reserve')
      .bearerToken(await tokenDe(client, 'cliente'))
      .json({
        ...destinoFuera,
        fechaProgramada: DateTime.now().setZone('America/Bogota').plus({ days: 1 }).toISODate(),
        horaProgramada: '10:00',
      })
    reserva.assertStatus(422)
    reserva.assertBodyContains({ error: mensaje })
  })

  test('una zona pausada deja de aceptar viajes', async ({ client }) => {
    const admin = await tokenDe(client, 'admin')
    await client
      .put('/api/admin/config/coverage')
      .bearerToken(admin)
      .json({ zonasCobertura: [{ ...POPAYAN, activa: false }] })

    const res = await client.post('/api/trips/request').bearerToken(await tokenDe(client, 'cliente')).json(viaje(2.44, -76.61))
    res.assertStatus(422)
  })

  test('sin zonas configuradas se acepta cualquier ubicación', async ({ client }) => {
    const res = await client.post('/api/trips/request').bearerToken(await tokenDe(client, 'cliente')).json(viaje(4.65, -74.05))
    res.assertStatus(200)
  })

  test('acepta zonas circulares y valida los viajes con el radio', async ({ client, assert }) => {
    const admin = await tokenDe(client, 'admin')
    // Círculo de 10 km alrededor del parque central de Popayán.
    const guardar = await client
      .put('/api/admin/config/coverage')
      .bearerToken(admin)
      .json({ zonasCobertura: [{ nombre: 'Popayán', tipo: 'circulo', lat: 2.4419, lng: -76.6063, radio: 10 }] })
    guardar.assertStatus(200)

    const zonas = await CoverageService.zonas()
    assert.equal(zonas[0].tipo, 'circulo')

    // Dentro del radio (centro de la ciudad).
    const dentro = await client.post('/api/trips/request').bearerToken(await tokenDe(client, 'cliente')).json(viaje(2.4460, -76.6000))
    dentro.assertStatus(200)

    // Fuera del radio (a más de 10 km).
    const fuera = await client.post('/api/trips/request').bearerToken(await tokenDe(client, 'cliente')).json(viaje(2.6000, -76.6000))
    fuera.assertStatus(422)
  })

  test('las zonas siguen ahí al recargar aunque haya varias filas de configuración', async ({ client, assert }) => {
    // Reproduce el fallo de producción: la tabla tenía más de una fila y
    // `ConfiguracionPlataforma.first()` (LIMIT 1 sin ORDER BY) no garantiza devolver
    // la misma en PostgreSQL, así que se guardaba en una fila y se leía de otra. El
    // admin veía "guardado" y, al recargar, la zona había desaparecido.
    await ConfiguracionPlataforma.create({ nequiNombre: 'fila vieja' })
    await ConfiguracionPlataforma.create({ nequiNombre: 'fila nueva' })

    const token = await tokenDe(client, 'admin')
    const guardar = await client
      .put('/api/admin/config/coverage')
      .bearerToken(token)
      .json({ zonasCobertura: [{ nombre: 'Popayán', tipo: 'circulo', lat: 2.4419, lng: -76.6063, radio: 9 }] })
    guardar.assertStatus(200)

    // Releer, como hace el panel al recargar la página.
    const recargado = await client.get('/api/admin/config/coverage').bearerToken(token)
    recargado.assertStatus(200)
    const zonas = (recargado.body() as any).zonasCobertura
    assert.lengthOf(zonas, 1, 'la zona se perdió al recargar')
    assert.equal(zonas[0].clave, 'popayan')
    assert.equal(zonas[0].radio, 9)

    // Y el servicio que valida los viajes ve lo mismo.
    assert.lengthOf(await CoverageService.zonasActivas(), 1)
  })

  test('guardar dos veces seguidas no pierde la zona', async ({ client, assert }) => {
    await ConfiguracionPlataforma.create({ nequiNombre: 'fila vieja' })
    const token = await tokenDe(client, 'admin')
    const zona = { nombre: 'Cali', tipo: 'circulo', lat: 3.4516, lng: -76.532, radio: 15 }

    for (const intento of [1, 2]) {
      const res = await client.put('/api/admin/config/coverage').bearerToken(token).json({ zonasCobertura: [zona] })
      res.assertStatus(200)
      assert.lengthOf((res.body() as any).zonasCobertura, 1, `intento ${intento}`)
    }

    const zonas = await CoverageService.zonas()
    assert.lengthOf(zonas, 1)
    assert.equal(zonas[0].nombre, 'Cali')
  })

  test('rechaza zonas con coordenadas inválidas', async ({ client }) => {
    const admin = await tokenDe(client, 'admin')
    const res = await client
      .put('/api/admin/config/coverage')
      .bearerToken(admin)
      .json({ zonasCobertura: [{ ...POPAYAN, norte: 2.4, sur: 2.5 }] })
    res.assertStatus(422)
  })
})
