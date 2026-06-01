import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'users'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.boolean('tiene_deuda_activa').notNullable().defaultTo(false)
      table.integer('reportes_infundados_conductor').notNullable().defaultTo(0)
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('tiene_deuda_activa')
      table.dropColumn('reportes_infundados_conductor')
    })
  }
}
