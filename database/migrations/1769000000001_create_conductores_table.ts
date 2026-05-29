import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'conductores'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table
        .integer('usuario_id')
        .notNullable()
        .unsigned()
        .references('id')
        .inTable('users')
        .onDelete('CASCADE')
        .unique()
      table.string('cedula', 20).notNullable().unique()
      table.string('placa', 20).notNullable().unique()
      table.text('foto_conductor').nullable()
      table.text('foto_vehiculo').nullable()
      table.boolean('online').defaultTo(false)
      table.decimal('calificacion', 2, 1).defaultTo(0.0)
      table.integer('total_viajes').defaultTo(0)
      table.decimal('horas_activo', 5, 1).defaultTo(0.0)
      table.decimal('ultima_ubicacion_lat', 10, 7).nullable()
      table.decimal('ultima_ubicacion_lng', 10, 7).nullable()
      table.timestamp('created_at').notNullable()
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
