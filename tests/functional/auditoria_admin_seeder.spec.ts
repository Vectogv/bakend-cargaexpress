import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import AdminSeeder from '#database/seeders/admin_seeder'

/**
 * Auditoría IMPORTANTE #7: las cuentas creadas por admin_seeder no podían
 * iniciar sesión (500 E_INVALID_DATE_COLUMN_VALUE) porque las fechas se
 * insertaban con `new Date()` crudo.
 */
test.group('Auditoría #7 - cuentas del admin_seeder', () => {
  test('las cuentas sembradas pueden iniciar sesión', async ({ client }) => {
    await new AdminSeeder(db.connection()).run()

    for (const email of ['admin@gmail.com', 'conductor@gmail.com', 'cliente@gmail.com']) {
      const res = await client.post('/api/auth/login').json({ email, password: '123456' })
      res.assertStatus(200)
    }
  })
})
