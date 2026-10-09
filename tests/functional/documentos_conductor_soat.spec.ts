import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import { DateTime } from 'luxon'
import Conductor, { SOAT_OBLIGATORIO } from '#models/conductor'
import User from '#models/user'
import { documentosCompletos } from '../helpers/documentos.js'

/**
 * Documentos nuevos de verificación (cédula reverso, tarjeta de propiedad,
 * tecnomecánica y SOAT con vencimiento) y la excepción del SOAT:
 *  - la fecha vencida da 422;
 *  - el conductor pide la excepción y el admin la aprueba o rechaza;
 *  - el admin solo puede aprobar con SOAT vigente o excepción aprobada;
 *  - aprobar exige licencia, SOAT, tecnomecánica, tarjeta de propiedad, foto del
 *    vehículo, foto del conductor y número de cédula (la foto de la cédula ya no).
 */

const uniq = () => `${Date.now()}${Math.floor(Math.random() * 1e6)}`
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64'
)
const manana = () => DateTime.now().plus({ days: 1 }).toISODate()!
const ayer = () => DateTime.now().minus({ days: 1 }).toISODate()!

async function crearUsuario(client: any, datos: Record<string, unknown>) {
  const user = await User.create({
    nombre: 'Test',
    apellido: 'Soat',
    email: `soat_${uniq()}@test.com`,
    password: 'Password123',
    rol: 'cliente',
    ...datos,
  } as any)
  const login = await client.post('/api/auth/login').json({ email: user.email, password: 'Password123' })
  login.assertStatus(200)
  return { user, token: login.body().token as string }
}

async function crearConductor(client: any, extra: Record<string, unknown> = {}) {
  const { user, token } = await crearUsuario(client, { rol: 'conductor' })
  const conductor = await Conductor.create({
    usuarioId: user.id,
    cedula: `${uniq()}`.slice(-10),
    placa: `SOA${`${uniq()}`.slice(-3)}`,
    tipoVehiculo: 'camioneta',
    capacidad: '1 tonelada',
    ciudad: 'popayan',
    estadoVerificacion: 'pendiente',
    ...extra,
  } as any)
  return { user, token, conductor }
}

function subir(client: any, token: string, tipo: string, vence?: string) {
  let req = client.post(`/api/drivers/verification/${tipo}`).bearerToken(token)
  if (vence) req = req.field('vence', vence)
  return req.file('file', PNG, { filename: `${tipo}.png`, contentType: 'image/png' })
}

test.group('Documentos del conductor y excepción del SOAT', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('sube cédula reverso y tarjeta de propiedad; el perfil los expone', async ({ client, assert }) => {
    const { token } = await crearConductor(client)

    ;(await subir(client, token, 'cedula-reverso')).assertStatus(200)
    ;(await subir(client, token, 'tarjeta-propiedad')).assertStatus(200)
    ;(await subir(client, token, 'documento-raro')).assertStatus(404)

    const perfil = await client.get('/api/users/profile').bearerToken(token)
    perfil.assertStatus(200)
    assert.include(perfil.body().conductor.fotoCedulaReverso, '/storage/uploads/cedula-reverso-')
    assert.include(perfil.body().conductor.fotoTarjetaPropiedad, '/storage/uploads/tarjeta-propiedad-')
    assert.isNull(perfil.body().conductor.fotoSoat)
    assert.isNull(perfil.body().conductor.excepcionSoatEstado)
  })

  test('tecnomecánica y SOAT exigen fecha de vencimiento no vencida', async ({ client, assert }) => {
    const { token } = await crearConductor(client)

    const sinFecha = await subir(client, token, 'soat')
    sinFecha.assertStatus(422)
    assert.include(sinFecha.body().error, 'fecha de vencimiento')

    const vencido = await subir(client, token, 'tecnomecanica', ayer())
    vencido.assertStatus(422)
    assert.include(vencido.body().error, 'vencido')

    const ok = await subir(client, token, 'soat', manana())
    ok.assertStatus(200)
    assert.equal(ok.body().soatVence, manana())

    ;(await subir(client, token, 'tecnomecanica', manana())).assertStatus(200)

    const perfil = await client.get('/api/users/profile').bearerToken(token)
    assert.equal(perfil.body().conductor.soatVence, manana())
    assert.equal(perfil.body().conductor.tecnomecanicaVence, manana())
  })

  test('sin ningún documento el admin no aprueba y el 422 dice qué falta', async ({ client, assert }) => {
    const admin = await crearUsuario(client, { rol: 'admin' })
    const { conductor } = await crearConductor(client)
    const res = await client.put(`/api/admin/verifications/${conductor.id}/approve`).bearerToken(admin.token)
    res.assertStatus(422)
    assert.deepEqual(res.body().faltantes, ['licencia', 'soat', 'tecnomecanica', 'tarjeta_propiedad', 'foto_vehiculo', 'foto_conductor'])
    assert.equal(res.body().error, 'Falta: Licencia, SOAT, Tecnomecánica, Tarjeta de propiedad, Foto del vehículo, Foto del conductor')
  })

  test('el admin no aprueba sin SOAT vigente, y sí con SOAT', async ({ client, assert }) => {
    const admin = await crearUsuario(client, { rol: 'admin' })
    const { fotoSoat: _s, soatVence: _v, ...sinSoatDocs } = documentosCompletos()
    const { token, conductor } = await crearConductor(client, sinSoatDocs)

    const sinSoat = await client.put(`/api/admin/verifications/${conductor.id}/approve`).bearerToken(admin.token)
    sinSoat.assertStatus(422)
    assert.include(sinSoat.body().error, 'SOAT')
    assert.deepEqual(sinSoat.body().faltantes, ['soat'])

    ;(await subir(client, token, 'soat', manana())).assertStatus(200)
    const conSoat = await client.put(`/api/admin/verifications/${conductor.id}/approve`).bearerToken(admin.token)
    conSoat.assertStatus(200)
    assert.equal(conSoat.body().estadoVerificacion, 'aprobado')
  }).skip(!SOAT_OBLIGATORIO, 'SOAT apagado (SOAT_OBLIGATORIO = false)')

  test('aprobar sin tarjeta de propiedad da 422 (admin y moderador)', async ({ client, assert }) => {
    const admin = await crearUsuario(client, { rol: 'admin' })
    const mod = await crearUsuario(client, { rol: 'moderador', esModerador: true, zonaModerador: 'popayan' })
    const { fotoTarjetaPropiedad: _t, ...sinTarjeta } = documentosCompletos()
    const { conductor } = await crearConductor(client, sinTarjeta)

    const res = await client.put(`/api/admin/verifications/${conductor.id}/approve`).bearerToken(admin.token)
    res.assertStatus(422)
    assert.equal(res.body().error, 'Falta: Tarjeta de propiedad')
    const resMod = await client.post(`/api/moderator/drivers/${conductor.id}/approve`).bearerToken(mod.token)
    resMod.assertStatus(422)
    assert.deepEqual(resMod.body().faltantes, ['tarjeta_propiedad'])
  })

  test('aprobar sin número de cédula válido da 422', async ({ client, assert }) => {
    const admin = await crearUsuario(client, { rol: 'admin' })
    const { conductor } = await crearConductor(client, { ...documentosCompletos(), cedula: 'ab' })
    const res = await client.put(`/api/admin/verifications/${conductor.id}/approve`).bearerToken(admin.token)
    res.assertStatus(422)
    assert.deepEqual(res.body().faltantes, ['numero_cedula'])
  })

  test('con todos los documentos, sin foto de la cédula, se aprueba (200) y perfil/lista traen faltantes vacíos', async ({ client, assert }) => {
    const admin = await crearUsuario(client, { rol: 'admin' })
    const { token, conductor } = await crearConductor(client, documentosCompletos())
    assert.isNotOk(conductor.fotoCedula)

    const perfil = await client.get('/api/users/profile').bearerToken(token)
    assert.deepEqual(perfil.body().conductor.faltantes, [])
    const lista = await client.get('/api/admin/verifications?limit=100').bearerToken(admin.token)
    const item = (lista.body() as any[]).find((c) => Number(c.id) === Number(conductor.id))
    assert.deepEqual(item.faltantes, [])

    const res = await client.put(`/api/admin/verifications/${conductor.id}/approve`).bearerToken(admin.token)
    res.assertStatus(200)
    assert.equal(res.body().estadoVerificacion, 'aprobado')
  })

  test('excepción del SOAT: el conductor la pide, el admin la aprueba y ya se puede aprobar al conductor', async ({ client, assert }) => {
    const admin = await crearUsuario(client, { rol: 'admin' })
    const { fotoSoat: _s, soatVence: _v, ...sinSoatDocs } = documentosCompletos()
    const { token, conductor } = await crearConductor(client, sinSoatDocs)

    // Sin excepción pendiente, el admin no tiene nada que resolver.
    ;(await client.put(`/api/admin/verifications/${conductor.id}/soat-exception`).bearerToken(admin.token).json({ aprobar: true })).assertStatus(409)

    const pedida = await client
      .post('/api/drivers/verification-soat/excepcion')
      .bearerToken(token)
      .json({ comentario: 'Es una moto de carga sin SOAT vigente' })
    pedida.assertStatus(200)
    assert.equal(pedida.body().excepcionSoatEstado, 'pendiente')

    const lista = await client.get('/api/admin/verifications?limit=100').bearerToken(admin.token)
    const item = (lista.body() as any[]).find((c) => Number(c.id) === Number(conductor.id))
    assert.equal(item.excepcionSoatEstado, 'pendiente')
    assert.equal(item.excepcionSoatNota, 'Es una moto de carga sin SOAT vigente')

    // Todavía sin SOAT ni excepción aprobada: no se puede aprobar.
    if (SOAT_OBLIGATORIO) {
      ;(await client.put(`/api/admin/verifications/${conductor.id}/approve`).bearerToken(admin.token)).assertStatus(422)
    }

    const aprobada = await client
      .put(`/api/admin/verifications/${conductor.id}/soat-exception`)
      .bearerToken(admin.token)
      .json({ aprobar: true, nota: 'Vehículo valorado en sede' })
    aprobada.assertStatus(200)
    assert.equal(aprobada.body().excepcionSoatEstado, 'aprobada')

    const perfil = await client.get('/api/users/profile').bearerToken(token)
    assert.equal(perfil.body().conductor.excepcionSoatEstado, 'aprobada')
    assert.equal(perfil.body().conductor.excepcionSoatNota, 'Vehículo valorado en sede')

    ;(await client.put(`/api/admin/verifications/${conductor.id}/approve`).bearerToken(admin.token)).assertStatus(200)
  })

  test('excepción del SOAT rechazada: sigue sin poder aprobarse', async ({ client, assert }) => {
    const admin = await crearUsuario(client, { rol: 'admin' })
    const { fotoSoat: _s, soatVence: _v, ...sinSoatDocs } = documentosCompletos()
    const { token, conductor } = await crearConductor(client, sinSoatDocs)

    ;(await client.post('/api/drivers/verification-soat/excepcion').bearerToken(token).json({})).assertStatus(200)
    const rechazada = await client
      .put(`/api/admin/verifications/${conductor.id}/soat-exception`)
      .bearerToken(admin.token)
      .json({ aprobar: false, nota: 'Trae el SOAT' })
    rechazada.assertStatus(200)
    assert.equal(rechazada.body().excepcionSoatEstado, 'rechazada')

    if (SOAT_OBLIGATORIO) {
      ;(await client.put(`/api/admin/verifications/${conductor.id}/approve`).bearerToken(admin.token)).assertStatus(422)
    }

    // El conductor puede volver a pedirla.
    const otra = await client.post('/api/drivers/verification-soat/excepcion').bearerToken(token).json({})
    assert.equal(otra.body().excepcionSoatEstado, 'pendiente')
  })

  test('un conductor ya aprobado sin SOAT sigue aprobado (la regla solo aplica al aprobar)', async ({ client, assert }) => {
    const { conductor } = await crearConductor(client)
    conductor.estadoVerificacion = 'aprobado'
    await conductor.save()
    const releido = await Conductor.findOrFail(conductor.id)
    assert.equal(releido.estadoVerificacion, 'aprobado')
    assert.isFalse(releido.soatValido)
  })
})
