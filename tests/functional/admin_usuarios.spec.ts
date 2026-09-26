import { test } from '@japa/runner'
import ConfiguracionPlataforma from '#models/configuracion_plataforma'
import User from '#models/user'

/**
 * Alta y edición de usuarios desde el panel de administración.
 *
 * Regresiones cubiertas:
 * - El formulario de alta no enviaba `edad`, obligatoria en el registro, así que
 *   crear cualquier usuario desde /admin/users fallaba con 422.
 * - PUT /api/admin/users/:id leía el body con request.only() sin validar: aceptaba
 *   emails con cualquier formato y edades imposibles.
 * - La zona del moderador estaba fijada a cali/popayan/pasto, así que a una ciudad
 *   nueva configurada en Cobertura no se le podía asignar ningún moderador.
 */

const uniq = () => `${Date.now()}${Math.floor(Math.random() * 1e6)}`

async function crear(client: any, extra: Record<string, unknown> = {}) {
  return client.post('/api/auth/register').json({
    nombre: 'Uso',
    apellido: 'Prueba',
    email: `usuario_${uniq()}@test.com`,
    password: 'Password123',
    rol: 'cliente',
    edad: 30,
    ...extra,
  })
}

async function adminToken(client: any) {
  const res = await crear(client)
  const body = res.body() as { token: string; id: string }
  await User.query().where('id', Number(body.id)).update({ rol: 'admin' })
  return body.token
}

test.group('Admin - alta y edición de usuarios', (group) => {
  group.each.setup(async () => {
    await ConfiguracionPlataforma.query().delete()
  })

  test('el registro exige la edad (contrato del formulario de alta)', async ({ client }) => {
    const res = await client.post('/api/auth/register').json({
      nombre: 'Sin',
      apellido: 'Edad',
      email: `sin_edad_${uniq()}@test.com`,
      password: 'Password123',
      rol: 'cliente',
    })
    res.assertStatus(422)
  })

  test('el registro exige los datos del vehículo a los conductores', async ({ client }) => {
    const sinVehiculo = await crear(client, { rol: 'conductor' })
    sinVehiculo.assertStatus(422)

    const completo = await crear(client, {
      rol: 'conductor',
      cedula: '1061234567',
      placa: `ABC${Math.floor(Math.random() * 900) + 100}`,
      tipoVehiculo: 'Turbo',
      capacidad: '1 tonelada',
      ciudad: 'popayan',
    })
    completo.assertStatus(200)
  })

  test('el registro no acepta rol admin (se promueve después)', async ({ client, assert }) => {
    const directo = await crear(client, { rol: 'admin' })
    directo.assertStatus(422)

    // Como lo hace el panel: crear como cliente y promover con el endpoint de rol.
    const admin = await adminToken(client)
    const nuevo = await crear(client)
    const id = (nuevo.body() as { id: string }).id

    const promovido = await client.put(`/api/admin/users/${id}/role`).bearerToken(admin).json({ rol: 'admin' })
    promovido.assertStatus(200)
    assert.equal((promovido.body() as any).rol, 'admin')
  })

  test('editar valida el formato del email y el rango de la edad', async ({ client }) => {
    const admin = await adminToken(client)
    const nuevo = await crear(client)
    const id = (nuevo.body() as { id: string }).id

    const email = await client.put(`/api/admin/users/${id}`).bearerToken(admin).json({ email: 'no-es-un-email' })
    email.assertStatus(422)

    const menor = await client.put(`/api/admin/users/${id}`).bearerToken(admin).json({ edad: 10 })
    menor.assertStatus(422)

    const imposible = await client.put(`/api/admin/users/${id}`).bearerToken(admin).json({ edad: 999 })
    imposible.assertStatus(422)

    const largo = await client
      .put(`/api/admin/users/${id}`)
      .bearerToken(admin)
      .json({ telefono: '1'.repeat(21) })
    largo.assertStatus(422)
  })

  test('editar guarda los cambios y permite borrar el teléfono', async ({ client, assert }) => {
    const admin = await adminToken(client)
    const nuevo = await crear(client, { telefono: '3001234567' })
    const id = (nuevo.body() as { id: string }).id

    const guardado = await client
      .put(`/api/admin/users/${id}`)
      .bearerToken(admin)
      .json({ nombre: 'Nombre', apellido: 'Nuevo', email: `editado_${uniq()}@test.com`, telefono: '3009999999', edad: 45 })
    guardado.assertStatus(200)
    assert.equal((guardado.body() as any).nombre, 'Nombre')
    assert.equal((guardado.body() as any).edad, 45)

    // Regresión: el panel omitía los campos vacíos y el teléfono no se podía borrar.
    const borrado = await client.put(`/api/admin/users/${id}`).bearerToken(admin).json({ telefono: null })
    borrado.assertStatus(200)
    assert.isNull((borrado.body() as any).telefono)
  })

  test('la zona del moderador usa las zonas configuradas en Cobertura', async ({ client, assert }) => {
    const admin = await adminToken(client)
    const nuevo = await crear(client)
    const id = (nuevo.body() as { id: string }).id

    // El admin configura una ciudad que no estaba en la lista fija anterior.
    const zonas = await client
      .put('/api/admin/config/coverage')
      .bearerToken(admin)
      .json({ zonasCobertura: [{ nombre: 'Tumaco', tipo: 'circulo', lat: 1.7986, lng: -78.7656, radio: 12 }] })
    zonas.assertStatus(200)

    const asignado = await client
      .put(`/api/admin/users/${id}/moderator`)
      .bearerToken(admin)
      .json({ esModerador: true, zonaModerador: 'tumaco' })
    asignado.assertStatus(200)
    assert.equal((asignado.body() as any).zonaModerador, 'tumaco')

    // Una ciudad que ya no está configurada deja de ser válida.
    const rechazado = await client
      .put(`/api/admin/users/${id}/moderator`)
      .bearerToken(admin)
      .json({ esModerador: true, zonaModerador: 'cali' })
    rechazado.assertStatus(422)
  })

  test('el listado de usuarios trae estadoCuenta, tieneDeudaActiva y montoDeuda', async ({
    client,
    assert,
  }) => {
    const admin = await adminToken(client)
    const email = `deudor_${uniq()}@test.com`
    const nuevo = await crear(client, { email })
    const id = Number((nuevo.body() as { id: string }).id)
    await User.query()
      .where('id', id)
      .update({ estado_cuenta: 'suspension_por_pago', tiene_deuda_activa: true, monto_deuda: 90000 })

    const res = await client.get('/api/admin/users').bearerToken(admin).qs({ search: email })
    res.assertStatus(200)
    const usuario = (res.body() as any[]).find((u) => u.id === id)
    assert.isDefined(usuario)
    assert.equal(usuario.estadoCuenta, 'suspension_por_pago')
    assert.isTrue(Boolean(usuario.tieneDeudaActiva))
    assert.equal(Number(usuario.montoDeuda), 90000)
  })

  test('sin zonas configuradas siguen valiendo las tres ciudades originales', async ({ client }) => {
    const admin = await adminToken(client)
    const nuevo = await crear(client)
    const id = (nuevo.body() as { id: string }).id

    const res = await client
      .put(`/api/admin/users/${id}/moderator`)
      .bearerToken(admin)
      .json({ esModerador: true, zonaModerador: 'popayan' })
    res.assertStatus(200)
  })
})
