import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'notificaciones'

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
      table.string('tipo', 50).notNullable()
      table.string('titulo', 255).notNullable()
      table.text('mensaje').nullable()
      table.boolean('leido').defaultTo(false)
      table.timestamp('created_at').notNullable()

      table.index(['usuario_id'], 'idx_notificaciones_usuario')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
