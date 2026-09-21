import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'
import RedisService from '#services/redis_service'

function email(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 100000000)}@test.com`
}

async function conductor(client: any) {
  const res = await client.post('/api/auth/register').json({
    nombre: 'GS', apellido: 'Conductor', email: email('gs-driver'), password: '123456', rol: 'conductor', edad: 30,
    cedula: `${Date.now()}${Math.floor(Math.random() * 100000)}`.slice(-16),
    placa: `GS${Date.now().toString().slice(-8)}${Math.floor(Math.random() * 1000)}`,
    tipoVehiculo: 'camioneta', capacidad: '1000 kg',
  })
  res.assertStatus(200)
  const fila = await db.from('conductores').where('usuario_id', Number(res.body().id)).first()
  return { token: res.body().token as string, conductorId: Number(fila.id), userId: Number(res.body().id) }
}

async function ganancia(conductorId: number, bruto: number, pagada = false) {
  await db.table('ganancias').insert({
    conductor_id: conductorId,
    viaje_id: null,
    monto: bruto,
    monto_bruto: bruto,
    comision: bruto * 0.1,
    monto_neto: bruto * 0.9,
    comision_pagada: pagada,
    created_at: DateTime.now().toSQL(),
  })
}

test.group('Ganancias del conductor: solo las propias', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('today-stats y earnings no mezclan ganancias de otros conductores', async ({ client, assert }) => {
    const a = await conductor(client)
    const b = await conductor(client)
    await ganancia(a.conductorId, 28000)
    await ganancia(b.conductorId, 100000)
    await ganancia(b.conductorId, 62000, true)

    const hoy = await client.get('/api/drivers/today-stats').header('Authorization', `Bearer ${a.token}`)
    hoy.assertStatus(200)
    assert.equal(hoy.body().viajesHoy, 1)
    assert.equal(hoy.body().gananciasHoy, 28000)
    assert.equal(hoy.body().comisionHoy, 2800)
    assert.equal(hoy.body().netaHoy, 25200)

    const earnB = await client.get('/api/drivers/earnings').header('Authorization', `Bearer ${b.token}`)
    earnB.assertStatus(200)
    assert.equal(earnB.body().total.viajesCompletados, 2)
    assert.equal(earnB.body().total.montoBruto, 162000)
    // Solo la comisión no pagada (100000 * 10 %) queda pendiente.
    assert.equal(earnB.body().total.comisionPendiente, 10000)

    // La caché en memoria sobrevive al rollback y los ids se reutilizan: limpiar
    // para no contaminar otros tests.
    for (const u of [a.userId, b.userId]) {
      await RedisService.cacheDel(`driver:todayStats:${u}`)
      await RedisService.cacheDel(`driver:earnings:${u}`)
    }
  })
})
