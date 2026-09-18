import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'alertas_emergencia'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.text('observacion').nullable()
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('observacion')
    })
  }
}