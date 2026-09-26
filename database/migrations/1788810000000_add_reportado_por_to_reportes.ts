import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Quién levantó el reporte: 'conductor' (contra el cliente del viaje) o
 * 'cliente' (contra el conductor asignado). Aditiva: los reportes existentes
 * son todos de conductores, de ahí el default.
 */
export default class extends BaseSchema {
  protected tableName = 'reportes'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.string('reportado_por', 20).notNullable().defaultTo('conductor')
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('reportado_por')
    })
  }
}
