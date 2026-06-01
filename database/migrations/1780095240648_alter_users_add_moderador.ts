import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'users'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.boolean('es_moderador').notNullable().defaultTo(false)
      table.string('zona_moderador').nullable()
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('es_moderador')
      table.dropColumn('zona_moderador')
    })
  }
}
