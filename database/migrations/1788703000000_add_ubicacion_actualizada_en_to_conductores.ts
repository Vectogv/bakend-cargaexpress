import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'conductores'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.timestamp('ubicacion_actualizada_en').nullable()
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('ubicacion_actualizada_en')
    })
  }
}