import { BaseSchema } from '@adonisjs/lucid/schema'

/** Penalizacion acumulada por cancelar viajes asignados; se resta a la calificacion visible. */
export default class extends BaseSchema {
  protected tableName = 'conductores'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.decimal('penalizacion_cancelacion', 3, 1).notNullable().defaultTo(0)
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('penalizacion_cancelacion')
    })
  }
}