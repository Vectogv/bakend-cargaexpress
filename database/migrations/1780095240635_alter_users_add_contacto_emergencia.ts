import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'users'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.string('contacto_emergencia_nombre').nullable()
      table.string('contacto_emergencia_telefono').nullable()
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('contacto_emergencia_nombre')
      table.dropColumn('contacto_emergencia_telefono')
    })
  }
}
