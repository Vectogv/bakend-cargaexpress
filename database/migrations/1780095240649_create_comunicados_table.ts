import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'comunicados'

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
      table.string('zona').notNullable()
      table.string('titulo').notNullable()
      table.text('contenido').notNullable()
      table.string('estado').notNullable().defaultTo('pendiente')
      table.string('nota_rechazo').nullable()
      table.timestamp('publicado_at').nullable()
      table.timestamp('created_at').notNullable()
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
