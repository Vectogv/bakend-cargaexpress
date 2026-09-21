import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'conductores'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.timestamp('updated_at').nullable()
    })

    this.defer(async (db) => {
      await db.rawQuery(
        `UPDATE conductores SET updated_at = COALESCE(updated_at, created_at) WHERE updated_at IS NULL`
      )
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('updated_at')
    })
  }
}