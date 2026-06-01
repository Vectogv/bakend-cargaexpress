import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'respuestas_encuesta'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table
        .integer('encuesta_id')
        .notNullable()
        .unsigned()
        .references('id')
        .inTable('encuestas')
        .onDelete('CASCADE')
      table
        .integer('conductor_id')
        .notNullable()
        .unsigned()
        .references('id')
        .inTable('conductores')
        .onDelete('CASCADE')
      table.string('opcion_elegida').notNullable()
      table.timestamp('created_at').notNullable()
      table.unique(['encuesta_id', 'conductor_id'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
