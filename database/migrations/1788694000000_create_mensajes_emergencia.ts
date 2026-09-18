import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'mensajes_emergencia'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table
        .integer('alerta_id')
        .unsigned()
        .references('id')
        .inTable('alertas_emergencia')
        .onDelete('CASCADE')
      table
        .integer('remitente_id')
        .unsigned()
        .references('id')
        .inTable('users')
        .onDelete('CASCADE')
      table.text('mensaje').notNullable()
      table.boolean('leido').defaultTo(false)
      table.timestamps(true, true)
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}