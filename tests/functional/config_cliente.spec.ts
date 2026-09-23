import { test } from '@japa/runner'
import antifraudeConfig from '#config/antifraude'

const uniq = () => `${Date.now()}${Math.floor(Math.random() * 1e6)}`

async function tokenCliente(client: any) {
  const res = await client.post('/api/auth/register').json({
    nombre: 'Reglas',
    apellido: 'Cliente',
    email: `reglas_${uniq()}@test.com`,
    password: 'Password123',
    rol: 'cliente',
    edad: 30,
  })
  return (res.body() as { token: string }).token
}

test.group('GET /api/config/cliente', () => {
  test('sin sesión responde 401', async ({ client }) => {
    const res = await client.get('/api/config/cliente')
    res.assertStatus(401)
  })

  test('con sesión devuelve las reglas que aplica el backend', async ({ client, assert }) => {
    const token = await tokenCliente(client)
    const res = await client.get('/api/config/cliente').bearerToken(token)
    res.assertStatus(200)
    assert.deepEqual(res.body(), {
      radioCierreKm: antifraudeConfig.radioCierreKm,
      confirmacionTimeoutMin: antifraudeConfig.confirmacionTimeoutMin,
    })
    assert.isNumber(res.body().radioCierreKm)
    assert.isNumber(res.body().confirmacionTimeoutMin)
  })
})
