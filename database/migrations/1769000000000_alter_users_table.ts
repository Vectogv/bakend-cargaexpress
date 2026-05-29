import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'users'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.string('nombre').nullable()
      table.string('apellido').nullable()
      table.string('telefono', 20).nullable()
      table.integer('edad').nullable()
      table.text('avatar').nullable()
      table.string('rol', 20).nullable()
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('nombre')
      table.dropColumn('apellido')
      table.dropColumn('telefono')
      table.dropColumn('edad')
      table.dropColumn('avatar')
      table.dropColumn('rol')
    })
  }
}
