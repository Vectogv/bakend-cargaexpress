import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'conductores'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.string('estado_verificacion', 20).notNullable().defaultTo('pendiente')
      table.string('foto_cedula').nullable()
      table.string('foto_licencia').nullable()
      table.text('nota_rechazo').nullable()
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('estado_verificacion')
      table.dropColumn('foto_cedula')
      table.dropColumn('foto_licencia')
      table.dropColumn('nota_rechazo')
    })
  }
}
