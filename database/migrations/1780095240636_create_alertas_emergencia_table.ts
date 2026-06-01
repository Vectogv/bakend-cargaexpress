import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'alertas_emergencia'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table
        .integer('user_id')
        .notNullable()
        .unsigned()
        .references('id')
        .inTable('users')
        .onDelete('CASCADE')
      table
        .integer('viaje_id')
        .nullable()
        .unsigned()
        .references('id')
        .inTable('viajes')
        .onDelete('SET NULL')
      table.decimal('lat', 10, 7).nullable()
      table.decimal('lng', 10, 7).nullable()
      table.boolean('atendida').notNullable().defaultTo(false)
      table.timestamp('created_at').notNullable()
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
