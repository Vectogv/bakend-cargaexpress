import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    this.schema.createTable('conversaciones', (table) => {
      table.increments('id')
      table
        .integer('moderador_id')
        .unsigned()
        .references('id')
        .inTable('users')
        .onDelete('CASCADE')
      table
        .integer('usuario_id')
        .unsigned()
        .references('id')
        .inTable('users')
        .onDelete('CASCADE')
      table
        .integer('viaje_id')
        .unsigned()
        .references('id')
        .inTable('viajes')
        .onDelete('SET NULL')
        .nullable()
      table.string('ciudad', 100).nullable()
      table.unique(['moderador_id', 'usuario_id', 'viaje_id'])
      table.timestamps(true, true)
    })

    this.schema.createTable('mensajes_conversacion', (table) => {
      table.increments('id')
      table
        .integer('conversacion_id')
        .unsigned()
        .references('id')
        .inTable('conversaciones')
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
    this.schema.dropTable('mensajes_conversacion')
    this.schema.dropTable('conversaciones')
  }
}