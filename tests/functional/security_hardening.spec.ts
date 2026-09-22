import { test } from '@japa/runner'
import User from '#models/user'
import SignedUploadService from '#services/signed_upload_service'

const uniq = () => `${Date.now()}${Math.floor(Math.random() * 1e6)}`

async function registrarCliente(client: any) {
  const email = `cliente_${uniq()}@test.com`
  const res = await client.post('/api/auth/register').json({
    nombre: 'Cliente',
    apellido: 'Prueba',
    email,
    password: 'Password123',
    telefono: `3${uniq().slice(-9)}`,
    rol: 'cliente',
    edad: 30,
  })
  const body = res.body() as { token: string; refreshToken: string; id: string }
  return { email, token: body.token, refreshToken: body.refreshToken, id: Number(body.id) }
}

test.group('Seguridad - sesiones y respuestas', () => {
  test('las respuestas de error llevan cuerpo (serialize esperado)', async ({ client }) => {
    const { token } = await registrarCliente(client)
    const res = await client.get('/api/disputes/999999').bearerToken(token)
    res.assertStatus(404)
    res.assertBodyContains({ error: 'Disputa no encontrada' })
  })

  test('un usuario suspendido pierde el acceso con código estable', async ({ client }) => {
    const { token, id } = await registrarCliente(client)
    await User.query().where('id', id).update({ suspendido: true })

    const res = await client.get('/api/users/profile').bearerToken(token)
    res.assertStatus(403)
    res.assertBodyContains({ code: 'CUENTA_SUSPENDIDA' })
  })

  test('el refresh token es de un solo uso y el logout lo revoca', async ({ client, assert }) => {
    const { refreshToken } = await registrarCliente(client)

    const r1 = await client.post('/api/auth/refresh-token').json({ refreshToken })
    r1.assertStatus(200)
    const nuevo = (r1.body() as { refreshToken: string }).refreshToken
    assert.notEqual(nuevo, refreshToken)

    const reuso = await client.post('/api/auth/refresh-token').json({ refreshToken })
    reuso.assertStatus(401)

    await client.post('/api/auth/logout').json({ refreshToken: nuevo })
    const trasLogout = await client.post('/api/auth/refresh-token').json({ refreshToken: nuevo })
    trasLogout.assertStatus(401)
  })

  test('documentos privados requieren URL firmada', async ({ client, assert }) => {
    const sinFirma = await client.get('/storage/uploads/cedula-1-prueba.png')
    sinFirma.assertStatus(403)

    const firmada = SignedUploadService.sign('/storage/uploads/cedula-1-prueba.png')
    assert.match(firmada, /\?exp=\d+&sig=[a-f0-9]{64}$/)
    // Firma válida → pasa el control (404 porque el archivo no existe en test)
    const conFirma = await client.get(firmada)
    conFirma.assertStatus(404)

    // Archivos públicos no se firman
    assert.equal(SignedUploadService.sign('/storage/uploads/avatar-1.png'), '/storage/uploads/avatar-1.png')
  })
})
