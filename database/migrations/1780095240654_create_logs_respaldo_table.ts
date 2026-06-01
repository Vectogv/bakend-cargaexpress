import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'logs_respaldo'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table.timestamp('fecha').notNullable()
      table.string('estado').notNullable()
      table.string('archivo').nullable()
      table.string('drive_id').nullable()
      table.text('error_mensaje').nullable()
      table.timestamp('created_at').notNullable()
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
