import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'logs_fraude'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table.integer('user_id').unsigned().references('id').inTable('users').onDelete('CASCADE')
      table.integer('conductor_id').unsigned().references('id').inTable('conductores').onDelete('SET NULL')
      table.string('tipo', 30).notNullable()
      table.text('descripcion').nullable()
      table.decimal('latitud', 10, 7).nullable()
      table.decimal('longitud', 10, 7).nullable()
      table.decimal('velocidad', 10, 2).nullable()
      table.json('metadata').nullable()
      table.timestamp('created_at').notNullable()

      table.index(['tipo'], 'idx_logs_fraude_tipo')
      table.index(['user_id'], 'idx_logs_fraude_user')
      table.index(['created_at'], 'idx_logs_fraude_created_at')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}