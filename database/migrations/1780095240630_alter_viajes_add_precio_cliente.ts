import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'viajes'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.decimal('precio_cliente', 10, 2).nullable().after('carga')
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('precio_cliente')
    })
  }
}
