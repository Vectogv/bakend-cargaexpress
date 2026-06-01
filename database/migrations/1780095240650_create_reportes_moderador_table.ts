import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'reportes_moderador'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table
        .integer('moderador_id')
        .notNullable()
        .unsigned()
        .references('id')
        .inTable('users')
        .onDelete('CASCADE')
      table
        .integer('conductor_id')
        .notNullable()
        .unsigned()
        .references('id')
        .inTable('conductores')
        .onDelete('CASCADE')
      table.text('descripcion').notNullable()
      table.string('estado').notNullable().defaultTo('pendiente')
      table.timestamp('created_at').notNullable()
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
