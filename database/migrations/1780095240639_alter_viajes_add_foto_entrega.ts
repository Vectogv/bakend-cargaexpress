import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'viajes'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.string('foto_entrega').nullable()
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('foto_entrega')
    })
  }
}
