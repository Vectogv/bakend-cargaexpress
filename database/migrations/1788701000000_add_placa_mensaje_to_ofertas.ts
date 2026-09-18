import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'ofertas'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.string('placa', 20).nullable()
      table.string('mensaje', 255).nullable()
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('placa')
      table.dropColumn('mensaje')
    })
  }
}