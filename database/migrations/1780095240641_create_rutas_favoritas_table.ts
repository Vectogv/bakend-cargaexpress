import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'rutas_favoritas'

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
      table.string('nombre').notNullable()
      table.string('origen_direccion').notNullable()
      table.decimal('origen_lat', 10, 7).notNullable()
      table.decimal('origen_lng', 10, 7).notNullable()
      table.string('destino_direccion').notNullable()
      table.decimal('destino_lat', 10, 7).notNullable()
      table.decimal('destino_lng', 10, 7).notNullable()
      table.timestamp('created_at').notNullable()
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
