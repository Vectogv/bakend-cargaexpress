import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Una sola calificación por (viaje, calificador). El código ya lo impide
 * (rate() responde 400 'Ya calificaste este viaje'); el índice único es la
 * última defensa ante dos peticiones simultáneas.
 */
export default class extends BaseSchema {
  protected tableName = 'calificaciones'

  async up() {
    // Duplicados históricos: se conserva el más antiguo (MIN(id)) de cada grupo.
    // Subconsulta derivada para que funcione igual en SQLite y Postgres.
    await this.db.rawQuery(`
      DELETE FROM calificaciones
      WHERE id NOT IN (
        SELECT keep_id FROM (
          SELECT MIN(id) AS keep_id
          FROM calificaciones
          GROUP BY viaje_id, calificador_id
        ) AS keepper
      )
    `)

    this.schema.alterTable(this.tableName, (table) => {
      table.unique(['viaje_id', 'calificador_id'], { indexName: 'uq_calificaciones_viaje_calificador' })
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropUnique(['viaje_id', 'calificador_id'], 'uq_calificaciones_viaje_calificador')
    })
  }
}
