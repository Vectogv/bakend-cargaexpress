import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'disputas'

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
      table.text('version_conductor').notNullable()
      table.text('version_cliente').nullable()
      table.string('soporte_cliente').nullable()
      table
        .enum('estado', ['abierta', 'en_revision', 'resuelta'])
        .notNullable()
        .defaultTo('abierta')
      table.enum('resultado', ['favor_conductor', 'favor_cliente']).nullable()
      table.timestamp('created_at').notNullable()
      table.timestamp('resuelta_at').nullable()
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
