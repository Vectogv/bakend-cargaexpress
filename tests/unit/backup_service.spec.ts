import { test } from '@japa/runner'
import { planDeVolcado, type ConfigVolcado } from '#services/backup_service'

const BASE: ConfigVolcado = {
  host: 'db.host',
  user: 'carga',
  password: 'secreto',
  database: 'carga',
}

test.group('Unit - respaldos', () => {
  test('con DATABASE_URL usa pg_dump y no necesita contraseña en el entorno', ({ assert }) => {
    const plan = planDeVolcado({ ...BASE, databaseUrl: 'postgresql://user:clave@db.host:5432/carga' })
    assert.equal(plan.motor, 'pg')
    assert.equal(plan.comando, 'pg_dump')
    assert.include(plan.args, 'postgresql://user:clave@db.host:5432/carga')
    assert.deepEqual(plan.envExtra, {})
  })

  test('con DB_CONNECTION=pg pasa la contraseña por PGPASSWORD, nunca en los argumentos', ({ assert }) => {
    const plan = planDeVolcado({ ...BASE, conexion: 'pg', port: 5432 })
    assert.equal(plan.comando, 'pg_dump')
    assert.equal(plan.envExtra.PGPASSWORD, 'secreto')
    assert.notInclude(plan.args.join(' '), 'secreto')
    assert.include(plan.args, '--port=5432')
  })

  test('con MySQL usa mysqldump y MYSQL_PWD', ({ assert }) => {
    const plan = planDeVolcado({ ...BASE, conexion: 'mysql', port: 3306 })
    assert.equal(plan.motor, 'mysql')
    assert.equal(plan.comando, 'mysqldump')
    assert.equal(plan.envExtra.MYSQL_PWD, 'secreto')
    assert.notInclude(plan.args.join(' '), 'secreto')
    assert.include(plan.args, '--single-transaction')
  })

  test('rechaza motores no soportados y bases sin nombre', ({ assert }) => {
    assert.throws(() => planDeVolcado({ ...BASE, conexion: 'sqlite' }), /solo soportan PostgreSQL y MySQL/)
    assert.throws(() => planDeVolcado({ ...BASE, conexion: 'pg', database: '' }), /DB_DATABASE no configurado/)
  })
})
