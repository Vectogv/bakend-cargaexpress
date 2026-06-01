import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'reportes'

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
        .integer('conductor_id')
        .notNullable()
        .unsigned()
        .references('id')
        .inTable('conductores')
        .onDelete('CASCADE')
      table
        .integer('cliente_id')
        .notNullable()
        .unsigned()
        .references('id')
        .inTable('users')
        .onDelete('CASCADE')
      table.string('motivo', 30).notNullable()
      table.text('descripcion').nullable()
      table.string('estado', 20).notNullable().defaultTo('pendiente')
      table.timestamp('created_at').notNullable()
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
