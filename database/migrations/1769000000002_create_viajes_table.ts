import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'viajes'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table
        .integer('cliente_id')
        .notNullable()
        .unsigned()
        .references('id')
        .inTable('users')
        .onDelete('CASCADE')
      table
        .integer('conductor_id')
        .nullable()
        .unsigned()
        .references('id')
        .inTable('conductores')
        .onDelete('SET NULL')
      table.string('estado', 20).notNullable().defaultTo('buscando_conductor')
      table.text('origen_direccion').notNullable()
      table.decimal('origen_lat', 10, 7).notNullable()
      table.decimal('origen_lng', 10, 7).notNullable()
      table.text('destino_direccion').notNullable()
      table.decimal('destino_lat', 10, 7).notNullable()
      table.decimal('destino_lng', 10, 7).notNullable()
      table.text('carga').nullable()
      table.decimal('precio_estimado', 10, 2).nullable()
      table.decimal('precio_final', 10, 2).nullable()
      table.text('motivo_cancelacion').nullable()
      table.integer('calificacion_cliente').nullable()
      table.timestamp('created_at').notNullable()
      table.timestamp('aceptado_at').nullable()
      table.timestamp('completado_at').nullable()
      table.timestamp('cancelado_at').nullable()

      table.index(['estado'], 'idx_viajes_estado')
      table.index(['conductor_id'], 'idx_viajes_conductor')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
