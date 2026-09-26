import { test } from '@japa/runner'

/**
 * GET /api/support/help es público: la pantalla de soporte de la app lo muestra
 * antes de iniciar sesión (teléfono y correo de contacto). Solo devuelve FAQ y
 * datos de contacto estáticos, nada sensible. El resto de /api/support sigue
 * exigiendo sesión.
 */
test.group('Soporte: ayuda pública', () => {
  test('GET /api/support/help responde sin sesión con FAQ y contacto', async ({ client, assert }) => {
    const res = await client.get('/api/support/help')
    res.assertStatus(200)

    const body = res.body()
    assert.isArray(body.faq)
    assert.isAbove(body.faq.length, 0)
    assert.isString(body.faq[0].pregunta)
    assert.isString(body.faq[0].respuesta)
    assert.isString(body.contacto?.email)
    assert.isString(body.contacto?.telefono)
    assert.deepEqual(Object.keys(body).sort(), ['contacto', 'faq'])
  })

  test('el resto de /api/support sigue exigiendo sesión', async ({ client }) => {
    const emergencia = await client.get('/api/support/emergency')
    emergencia.assertStatus(401)

    const tickets = await client.get('/api/support/tickets')
    tickets.assertStatus(401)
  })
})
