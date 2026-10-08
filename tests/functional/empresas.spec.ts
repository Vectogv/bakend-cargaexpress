import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import { DateTime } from 'luxon'
import Conductor from '#models/conductor'
import Empresa from '#models/empresa'
import Notificacion from '#models/notificacion'
import User from '#models/user'
import Viaje from '#models/viaje'

/**
 * Cuentas de empresa (fase 1): registro con RUT y Cámara, aprobación del admin,
 * código de unión, sello en los viajes, resumen y PDF del mes.
 */

const uniq = () => `${Date.now()}${Math.floor(Math.random() * 1e6)}`
const ORIGEN = { direccion: 'Parque Caldas, Popayán', lat: 2.4419, lng: -76.6063 }
const DESTINO = { direccion: 'Terminal, Popayán', lat: 2.4569, lng: -76.5952 }
const PRECIO = 20000
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64'
)
const mesActual = () => DateTime.now().setZone('America/Bogota').toFormat('yyyy-MM')

async function cuenta(client: any, rol: 'cliente' | 'conductor', nombre = 'Pedro') {
  const base =
    rol === 'conductor'
      ? {
          cedula: `${uniq()}`.slice(-9),
          placa: `E${`${uniq()}`.slice(-9)}`,
          tipoVehiculo: 'camioneta',
          capacidad: '1 tonelada',
          ciudad: 'popayan',
        }
      : {}
  const res = await client.post('/api/auth/register').json({
    nombre,
    apellido: 'Empresa',
    email: `emp_${rol}_${uniq()}@test.com`,
    password: 'Password123',
    rol,
    edad: 30,
    ...base,
  })
  res.assertStatus(200)
  const body = res.body() as { token: string; id: string }
  return { token: body.token, id: Number(body.id) }
}

async function adminToken(client: any) {
  const admin = await cuenta(client, 'cliente')
  await User.query().where('id', admin.id).update({ rol: 'admin' })
  return admin.token
}

async function conductorListo(client: any, admin: string) {
  const usuario = await cuenta(client, 'conductor', 'Carlos')
  const conductor = await Conductor.findByOrFail('usuario_id', usuario.id)
  ;(await client.put(`/api/admin/verifications/${conductor.id}/approve`).bearerToken(admin)).assertStatus(200)
  conductor.ultimaUbicacionLat = ORIGEN.lat
  conductor.ultimaUbicacionLng = ORIGEN.lng
  conductor.ubicacionActualizadaEn = DateTime.now()
  conductor.online = true
  await conductor.save()
  return { ...usuario, conductorId: conductor.id }
}

/** POST /api/empresas con RUT y Cámara (PNG de 1 px). */
function registrarEmpresa(client: any, token: string, datos: Record<string, string> = {}, conArchivos = true) {
  let req = client
    .post('/api/empresas')
    .bearerToken(token)
    .field('nombre', datos.nombre ?? 'Transportes Prueba')
    .field('nit', datos.nit ?? `900.${`${uniq()}`.slice(-6)}-1`)
    .field('direccion', datos.direccion ?? 'Calle 5 # 3-20')
    .field('telefono', datos.telefono ?? '3001234567')
  if (conArchivos) {
    req = req
      .file('rut', PNG, { filename: 'rut.png', contentType: 'image/png' })
      .file('camara', PNG, { filename: 'camara.png', contentType: 'image/png' })
  }
  return req
}

/** Empresa registrada y aprobada; devuelve dueño, id y código. */
async function empresaAprobada(client: any, admin: string) {
  const dueno = await cuenta(client, 'cliente', 'Dueña')
  const res = await registrarEmpresa(client, dueno.token)
  res.assertStatus(201)
  const id = (res.body() as any).id as number
  ;(await client.put(`/api/admin/empresas/${id}/approve`).bearerToken(admin)).assertStatus(200)
  const mia = await client.get('/api/empresas/mia').bearerToken(dueno.token)
  return { dueno, id, codigo: (mia.body() as any).empresa.codigo as string }
}

async function unirse(client: any, token: string, codigo: string) {
  return client.post('/api/empresas/unirse').bearerToken(token).json({ codigo })
}

async function viajeCompleto(client: any, cliente: string, driver: { token: string; conductorId: number }) {
  const pedido = await client.post('/api/trips/request').bearerToken(cliente).json({
    origen: ORIGEN,
    destino: DESTINO,
    descripcion: 'Caja',
    precioCliente: PRECIO,
  })
  pedido.assertStatus(200)
  const viajeId = (pedido.body() as { id: string }).id
  await Conductor.query().where('id', driver.conductorId).update({
    ultima_ubicacion_lat: ORIGEN.lat,
    ultima_ubicacion_lng: ORIGEN.lng,
    ubicacion_actualizada_en: DateTime.now().toSQL(),
  })
  const oferta = await client.post(`/api/trips/${viajeId}/offers`).bearerToken(driver.token).json({ monto: PRECIO })
  oferta.assertStatus(201)
  const ofertaId = (oferta.body() as { id: string }).id
  const acepta = await client.post(`/api/trips/${viajeId}/offers/${ofertaId}/accept`).bearerToken(cliente)
  acepta.assertStatus(200)
  for (const ruta of ['confirm-arrival', 'confirm-pickup', 'start-trip']) {
    ;(await client.post(`/api/trips/${viajeId}/${ruta}`).bearerToken(driver.token)).assertStatus(200)
  }
  await Conductor.query().where('id', driver.conductorId).update({
    ultima_ubicacion_lat: DESTINO.lat,
    ultima_ubicacion_lng: DESTINO.lng,
    ubicacion_actualizada_en: DateTime.now().toSQL(),
  })
  ;(
    await client
      .post(`/api/trips/${viajeId}/complete`)
      .bearerToken(driver.token)
      .json({ montoFinal: PRECIO, pin: (acepta.body() as any).pinEntrega })
  ).assertStatus(200)
  ;(await client.post(`/api/trips/${viajeId}/confirm-close`).bearerToken(cliente).json({ confirmar: true })).assertStatus(200)
  return Number(viajeId)
}

test.group('Cuentas de empresa', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('registrar: queda pendiente, aparece en el perfil, y no se puede dos veces ni con el mismo NIT', async ({ client, assert }) => {
    const dueno = await cuenta(client, 'cliente')
    const res = await registrarEmpresa(client, dueno.token, { nit: '900.111.222-3' })
    res.assertStatus(201)
    const empresa = res.body() as any
    assert.equal(empresa.estado, 'pendiente')
    assert.equal(empresa.nit, '9001112223')
    assert.isTrue(empresa.esDueno)
    assert.isNull(empresa.codigo)

    const mia = (await client.get('/api/empresas/mia').bearerToken(dueno.token)).body() as any
    assert.equal(mia.empresa.id, empresa.id)
    assert.lengthOf(mia.miembros, 1)
    assert.isTrue(mia.miembros[0].esDueno)
    assert.isNull(mia.resumen)

    const perfil = (await client.get('/api/users/profile').bearerToken(dueno.token)).body() as any
    assert.deepEqual(perfil.empresa, { id: empresa.id, nombre: 'Transportes Prueba', estado: 'pendiente', esDueno: true })

    const doble = await registrarEmpresa(client, dueno.token)
    doble.assertStatus(409)
    assert.equal((doble.body() as any).code, 'YA_TIENE_EMPRESA')

    const otro = await cuenta(client, 'cliente')
    const repetido = await registrarEmpresa(client, otro.token, { nit: '9001112223' })
    repetido.assertStatus(409)
    assert.equal((repetido.body() as any).code, 'NIT_REPETIDO')

    const sinArchivos = await registrarEmpresa(client, otro.token, {}, false)
    sinArchivos.assertStatus(422)
    assert.equal((sinArchivos.body() as any).code, 'ARCHIVOS_REQUERIDOS')
  })

  test('los archivos son privados: el admin recibe URL firmadas y la ruta directa da 403', async ({ client, assert }) => {
    const admin = await adminToken(client)
    const dueno = await cuenta(client, 'cliente')
    ;(await registrarEmpresa(client, dueno.token)).assertStatus(201)

    const lista = await client.get('/api/admin/empresas?estado=pendiente').bearerToken(admin)
    lista.assertStatus(200)
    const fila = (lista.body() as any).data.find((e: any) => e.dueno?.id === dueno.id)
    assert.exists(fila)
    assert.include(fila.rut, 'sig=')
    assert.include(fila.camara, 'sig=')
    assert.equal(fila.miembros, 1)

    const empresa = await Empresa.findByOrFail('owner_user_id', dueno.id)
    ;(await client.get(empresa.fotoRut!)).assertStatus(403)
    ;(await client.get(fila.rut)).assertStatus(200)
  })

  test('aprobar, rechazar y reenviar tras el rechazo', async ({ client, assert }) => {
    const admin = await adminToken(client)
    const dueno = await cuenta(client, 'cliente')
    const id = ((await registrarEmpresa(client, dueno.token)).body() as any).id

    const rechazo = await client.put(`/api/admin/empresas/${id}/reject`).bearerToken(admin).json({ nota: 'RUT ilegible' })
    rechazo.assertStatus(200)
    let mia = (await client.get('/api/empresas/mia').bearerToken(dueno.token)).body() as any
    assert.equal(mia.empresa.estado, 'rechazado')
    assert.equal(mia.empresa.notaRechazo, 'RUT ilegible')
    assert.equal(await Notificacion.query().where('usuario_id', dueno.id).where('tipo', 'empresa_estado').count('* as c').first().then((r) => Number(r?.$extras.c)), 1)

    // Reenvío: mismo POST, sin volver a subir archivos.
    const reenvio = await registrarEmpresa(client, dueno.token, { nombre: 'Transportes Prueba SAS' }, false)
    reenvio.assertStatus(201)
    assert.equal((reenvio.body() as any).estado, 'pendiente')
    assert.isNull((reenvio.body() as any).notaRechazo)
    assert.equal((reenvio.body() as any).nombre, 'Transportes Prueba SAS')

    ;(await client.put(`/api/admin/empresas/${id}/approve`).bearerToken(admin)).assertStatus(200)
    mia = (await client.get('/api/empresas/mia').bearerToken(dueno.token)).body() as any
    assert.equal(mia.empresa.estado, 'aprobado')
    assert.match(mia.empresa.codigo, /^[A-Z]{4}\d{4}$/)
    assert.isNotNull(mia.resumen)
    assert.equal(mia.resumen.viajes, 0)

    ;(await client.put('/api/admin/empresas/999999/approve').bearerToken(admin)).assertStatus(404)
  })

  test('unirse: código inválido 422, antes de aprobar 422, doble empresa 409', async ({ client, assert }) => {
    const admin = await adminToken(client)
    const dueno = await cuenta(client, 'cliente')
    const id = ((await registrarEmpresa(client, dueno.token)).body() as any).id
    const empleado = await cuenta(client, 'cliente')

    const malo = await unirse(client, empleado.token, 'NOEX0000')
    malo.assertStatus(422)
    assert.equal((malo.body() as any).code, 'CODIGO_INVALIDO')

    const codigo = (await Empresa.findOrFail(id)).codigoUnion
    const antes = await unirse(client, empleado.token, codigo)
    antes.assertStatus(422)
    assert.equal((antes.body() as any).code, 'CODIGO_INVALIDO')

    ;(await client.put(`/api/admin/empresas/${id}/approve`).bearerToken(admin)).assertStatus(200)
    const ok = await unirse(client, empleado.token, codigo.toLowerCase())
    ok.assertStatus(200)
    assert.deepEqual((ok.body() as any).empresa, { id, nombre: 'Transportes Prueba', estado: 'aprobado', esDueno: false })

    const otra = await empresaAprobada(client, admin)
    const doble = await unirse(client, empleado.token, otra.codigo)
    doble.assertStatus(409)
    assert.equal((doble.body() as any).code, 'YA_TIENE_EMPRESA')
    const registra = await registrarEmpresa(client, empleado.token)
    registra.assertStatus(409)
    const duenoUne = await unirse(client, dueno.token, otra.codigo)
    duenoUne.assertStatus(409)

    // El empleado ve su empresa sin miembros ni resumen; el dueño ve a los dos.
    const miaEmpleado = (await client.get('/api/empresas/mia').bearerToken(empleado.token)).body() as any
    assert.isFalse(miaEmpleado.empresa.esDueno)
    assert.isNull(miaEmpleado.empresa.codigo)
    assert.lengthOf(miaEmpleado.miembros, 0)
    assert.isNull(miaEmpleado.resumen)
    const miaDueno = (await client.get('/api/empresas/mia').bearerToken(dueno.token)).body() as any
    assert.lengthOf(miaDueno.miembros, 2)
    assert.isTrue(miaDueno.miembros[0].esDueno)

    ;(await client.post('/api/empresas/salir').bearerToken(dueno.token)).assertStatus(422)
    ;(await client.post('/api/empresas/salir').bearerToken(empleado.token)).assertStatus(200)
    assert.isNull((await User.findOrFail(empleado.id)).empresaId)
  })

  test('el viaje del empleado lleva la empresa; al quitarlo el siguiente no, y el reporte conserva los viejos', async ({ client, assert }) => {
    const admin = await adminToken(client)
    const { dueno, id, codigo } = await empresaAprobada(client, admin)
    const empleado = await cuenta(client, 'cliente', 'Empleado')
    ;(await unirse(client, empleado.token, codigo)).assertStatus(200)
    const driver = await conductorListo(client, admin)

    const pedido = await client.post('/api/trips/request').bearerToken(empleado.token).json({
      origen: ORIGEN,
      destino: DESTINO,
      descripcion: 'Caja',
      precioCliente: PRECIO,
    })
    pedido.assertStatus(200)
    const viajeId = Number((pedido.body() as any).id)
    assert.equal((await Viaje.findOrFail(viajeId)).empresaId, id)

    const cercanos = await client.get(`/api/trips/nearby?lat=${ORIGEN.lat}&lng=${ORIGEN.lng}`).bearerToken(driver.token)
    cercanos.assertStatus(200)
    const visto = (cercanos.body() as any[]).find((v) => Number(v.id) === viajeId)
    assert.deepEqual(visto.cliente.empresa, { nombre: 'Transportes Prueba' })

    ;(await client.post(`/api/trips/${viajeId}/cancel`).bearerToken(empleado.token).json({ motivo: 'prueba' })).assertStatus(200)
    const hecho = await viajeCompleto(client, empleado.token, driver)

    ;(await client.delete(`/api/empresas/miembros/${dueno.id}`).bearerToken(dueno.token)).assertStatus(422)
    ;(await client.delete(`/api/empresas/miembros/${empleado.id}`).bearerToken(empleado.token)).assertStatus(403)
    ;(await client.delete(`/api/empresas/miembros/${empleado.id}`).bearerToken(dueno.token)).assertStatus(200)
    ;(await client.delete(`/api/empresas/miembros/${empleado.id}`).bearerToken(dueno.token)).assertStatus(404)
    assert.isNull((await User.findOrFail(empleado.id)).empresaId)

    const sinEmpresa = await client.post('/api/trips/request').bearerToken(empleado.token).json({
      origen: ORIGEN,
      destino: DESTINO,
      descripcion: 'Caja',
      precioCliente: PRECIO,
    })
    sinEmpresa.assertStatus(200)
    assert.isNull((await Viaje.findOrFail(Number((sinEmpresa.body() as any).id))).empresaId)

    const resumen = await client.get(`/api/empresas/resumen?mes=${mesActual()}`).bearerToken(dueno.token)
    resumen.assertStatus(200)
    assert.equal((resumen.body() as any).viajes, 1)
    assert.equal((resumen.body() as any).detalle[0].id, hecho)
    assert.equal((resumen.body() as any).detalle[0].solicitante, 'Empleado Empresa')
  })

  test('resumen del mes con 2 empleados, PDF y 403 para el empleado', async ({ client, assert }) => {
    const admin = await adminToken(client)
    const { dueno, codigo } = await empresaAprobada(client, admin)
    const a = await cuenta(client, 'cliente', 'Ana')
    const b = await cuenta(client, 'cliente', 'Beto')
    ;(await unirse(client, a.token, codigo)).assertStatus(200)
    ;(await unirse(client, b.token, codigo)).assertStatus(200)
    const driver = await conductorListo(client, admin)
    await viajeCompleto(client, a.token, driver)
    await viajeCompleto(client, b.token, driver)
    await viajeCompleto(client, b.token, driver)

    const mes = mesActual()
    const res = await client.get(`/api/empresas/resumen?mes=${mes}`).bearerToken(dueno.token)
    res.assertStatus(200)
    const r = res.body() as any
    assert.equal(r.mes, mes)
    assert.equal(r.viajes, 3)
    assert.equal(r.total, 3 * PRECIO)
    assert.deepEqual(
      r.porUsuario.map((u: any) => [u.userId, u.viajes, u.total]),
      [
        [b.id, 2, 2 * PRECIO],
        [a.id, 1, PRECIO],
      ]
    )
    assert.lengthOf(r.conductores, 1)
    assert.equal(r.conductores[0].conductorId, driver.conductorId)
    assert.equal(r.conductores[0].viajes, 3)
    assert.lengthOf(r.detalle, 3)
    assert.equal(r.detalle[0].valor, PRECIO)
    assert.equal(r.detalle[0].conductor, 'Carlos Empresa')

    const mia = (await client.get('/api/empresas/mia').bearerToken(dueno.token)).body() as any
    assert.equal(mia.resumen.viajes, 3)
    const vacio = (await client.get('/api/empresas/resumen?mes=2000-01').bearerToken(dueno.token)).body() as any
    assert.equal(vacio.viajes, 0)
    ;(await client.get('/api/empresas/resumen?mes=hoy').bearerToken(dueno.token)).assertStatus(422)

    const pdf = await client.get(`/api/empresas/reporte?mes=${mes}`).bearerToken(dueno.token)
    pdf.assertStatus(200)
    assert.include(pdf.header('content-type'), 'application/pdf')
    assert.include(pdf.header('content-disposition'), `empresa-${mes}.pdf`)

    const empleado = await client.get(`/api/empresas/resumen?mes=${mes}`).bearerToken(a.token)
    empleado.assertStatus(403)
    assert.equal((empleado.body() as any).code, 'NO_ES_DUENO')
    ;(await client.get(`/api/empresas/reporte?mes=${mes}`).bearerToken(a.token)).assertStatus(403)
  })
})
