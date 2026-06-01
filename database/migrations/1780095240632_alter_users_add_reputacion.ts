import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'users'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.decimal('reputacion', 2, 1).notNullable().defaultTo(5.0)
      table.string('visibilidad', 20).notNullable().defaultTo('normal')
      table.integer('total_reportes').notNullable().defaultTo(0)
      table.integer('total_viajes_completados').notNullable().defaultTo(0)
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('reputacion')
      table.dropColumn('visibilidad')
      table.dropColumn('total_reportes')
      table.dropColumn('total_viajes_completados')
    })
  }
}
