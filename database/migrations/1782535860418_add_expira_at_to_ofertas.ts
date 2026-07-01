import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'ofertas'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.timestamp('expira_at').nullable().after('estado')
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('expira_at')
    })
  }
}
