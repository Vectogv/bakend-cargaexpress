import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'alertas_emergencia'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table
        .string('estado', 20)
        .notNullable()
        .defaultTo('pendiente')
      table
        .integer('moderador_atendio_id')
        .nullable()
        .unsigned()
        .references('id')
        .inTable('users')
        .onDelete('SET NULL')
      table
        .integer('moderador_resolvio_id')
        .nullable()
        .unsigned()
        .references('id')
        .inTable('users')
        .onDelete('SET NULL')
      table.timestamp('atendida_at').nullable()
      table.timestamp('resuelta_at').nullable()
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('estado')
      table.dropColumn('moderador_atendio_id')
      table.dropColumn('moderador_resolvio_id')
      table.dropColumn('atendida_at')
      table.dropColumn('resuelta_at')
    })
  }
}