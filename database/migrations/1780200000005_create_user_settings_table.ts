import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'user_settings'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table
        .integer('user_id')
        .notNullable()
        .unsigned()
        .unique()
        .references('id')
        .inTable('users')
        .onDelete('CASCADE')
      table.string('idioma', 10).notNullable().defaultTo('es')
      table.boolean('notificaciones_sonido').notNullable().defaultTo(true)
      table.string('visibilidad', 20).notNullable().defaultTo('visible')
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
