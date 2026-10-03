import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import {
  planDeVolcado,
  tocaRespaldar,
  respaldosSobrantes,
  aplicarRetencion,
  type ConfigVolcado,
} from '#services/backup_service'

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

test.group('Unit - respaldo diario y retención', () => {
  const bogota = (iso: string) => DateTime.fromISO(iso, { zone: 'America/Bogota' })

  test('no toca antes de las 3:00 a. m. de Colombia', ({ assert }) => {
    assert.isFalse(tocaRespaldar(bogota('2026-10-02T02:59:00'), null))
  })

  test('toca pasadas las 3:00 si no hay ningún respaldo', ({ assert }) => {
    assert.isTrue(tocaRespaldar(bogota('2026-10-02T03:00:00'), null))
  })

  test('no toca si ya hay uno exitoso hoy (fecha Colombia) y sí si fue ayer', ({ assert }) => {
    const ahora = bogota('2026-10-02T10:00:00')
    // 08:30 UTC = 03:30 en Bogotá, mismo día
    assert.isFalse(tocaRespaldar(ahora, DateTime.fromISO('2026-10-02T08:30:00Z')))
    // 04:30 UTC = 23:30 de ayer en Bogotá
    assert.isTrue(tocaRespaldar(ahora, DateTime.fromISO('2026-10-02T04:30:00Z')))
  })

  test('de 33 respaldos borra los 3 más viejos', ({ assert }) => {
    const lista = Array.from({ length: 33 }, (_, i) => ({ id: `f${i}` })) // f0 = más nuevo
    assert.deepEqual(respaldosSobrantes(lista), [{ id: 'f30' }, { id: 'f31' }, { id: 'f32' }])
    assert.lengthOf(respaldosSobrantes(lista.slice(0, 30)), 0)
  })

  test('aplicarRetencion pide a Drive borrar solo los sobrantes', async ({ assert }) => {
    const borrados: string[] = []
    const drive: any = {
      files: {
        list: async () => ({ data: { files: Array.from({ length: 33 }, (_, i) => ({ id: `f${i}` })) } }),
        delete: async ({ fileId }: { fileId: string }) => void borrados.push(fileId),
      },
    }
    await aplicarRetencion(drive, 'carpeta')
    assert.deepEqual(borrados, ['f30', 'f31', 'f32'])
  })
})
