import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'ganancias'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table
        .integer('conductor_id')
        .notNullable()
        .unsigned()
        .references('id')
        .inTable('conductores')
        .onDelete('CASCADE')
      table
        .integer('viaje_id')
        .nullable()
        .unsigned()
        .references('id')
        .inTable('viajes')
        .onDelete('SET NULL')
      table.decimal('monto', 10, 2).notNullable()
      table.timestamp('created_at').notNullable()

      table.index(['conductor_id'], 'idx_ganancias_conductor')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
