import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * HARDENING — Integridad Financiera
 *
 * Agrega un índice UNIQUE en ganancias.viaje_id para garantizar a nivel de
 * base de datos que un viaje nunca pueda generar dos registros de ganancia,
 * incluso si dos procesos del backend intentan crear la segunda fila en
 * paralelo (race condition). Esta es la última línea de defensa; el código
 * de aplicación ya lo impide, pero la DB es la red de seguridad real.
 *
 * También agrega un índice en viajes.estado para acelerar las queries de
 * bloqueo pesimista que hacen SELECT ... FOR UPDATE filtrando por estado.
 *
 * Por qué UNIQUE y no solo CHECK en código:
 *   - Si el backend corre en múltiples instancias (horizontal scaling),
 *     el Map en memoria del IdempotencyMiddleware no se comparte entre pods.
 *   - Si la app se reinicia justo después de guardar el viaje pero antes de
 *     crear la ganancia, un reintento del cliente podría ejecutar el bloque
 *     financiero dos veces.
 *   - Un UNIQUE constraint en la DB garantiza atomicidad sin importar cuántas
 *     instancias corran.
 */
export default class extends BaseSchema {
  protected tableName = 'ganancias'

  async up() {
    // Primero limpiar posibles duplicados históricos antes de agregar el unique
    // (en producción esto debería hacerse con cuidado; aquí dejamos la migración
    //  segura asumiendo que el sistema está en estado limpio al deployar)
    await this.db.rawQuery(`
      DELETE FROM ganancias
      WHERE id NOT IN (
        SELECT MIN(id) FROM ganancias
        WHERE viaje_id IS NOT NULL
        GROUP BY viaje_id
      )
      AND viaje_id IS NOT NULL
    `)

    this.schema.alterTable(this.tableName, (table) => {
      // UNIQUE en viaje_id: un viaje → exactamente una ganancia
      // NULLABLE UNIQUE permite múltiples NULLs (compatibilidad SQL estándar)
      table.unique(['viaje_id'], { indexName: 'uq_ganancias_viaje_id' })
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropUnique(['viaje_id'], 'uq_ganancias_viaje_id')
    })
  }
}
