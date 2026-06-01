import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'calificaciones'

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
        .integer('calificador_id')
        .notNullable()
        .unsigned()
        .references('id')
        .inTable('users')
        .onDelete('CASCADE')
      table
        .integer('calificado_id')
        .notNullable()
        .unsigned()
        .references('id')
        .inTable('users')
        .onDelete('CASCADE')
      table.tinyint('puntaje').notNullable().unsigned()
      table.string('comentario').nullable()
      table.enum('tipo', ['cliente_a_conductor', 'conductor_a_cliente']).notNullable()
      table.timestamp('created_at').notNullable()
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
