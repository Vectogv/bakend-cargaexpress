import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'ubicaciones_drivers'

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
      table.decimal('lat', 10, 7).notNullable()
      table.decimal('lng', 10, 7).notNullable()
      table.timestamp('created_at').notNullable()

      table.index(['conductor_id'], 'idx_ubicaciones_conductor')
      table.index(['created_at'], 'idx_ubicaciones_fecha')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
