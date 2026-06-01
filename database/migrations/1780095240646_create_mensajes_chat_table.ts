import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'mensajes_chat'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table
        .integer('viaje_id')
        .notNullable()
        .unsigned()
        .references('id')
        .inTable('viajes')
        .onDelete('CASCADE')
      table
        .integer('remitente_id')
        .notNullable()
        .unsigned()
        .references('id')
        .inTable('users')
        .onDelete('CASCADE')
      table.text('mensaje').notNullable()
      table.boolean('leido').notNullable().defaultTo(false)
      table.timestamp('created_at').notNullable()
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
