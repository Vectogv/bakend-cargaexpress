import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'codigos_recuperacion'

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
      // Solo el hash del código (HMAC con APP_KEY): una fuga de la BD no sirve para resetear.
      table.string('codigo_hash', 64).notNullable()
      table.timestamp('expira_at').notNullable()
      table.integer('intentos').notNullable().defaultTo(0)
      table.timestamp('usado_at').nullable()
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()
      table.index(['user_id'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
