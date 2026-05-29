import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'viajes'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.timestamp('en_curso_at').nullable().after('aceptado_at')
      table.timestamp('finalizado_at').nullable().after('completado_at')
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('en_curso_at')
      table.dropColumn('finalizado_at')
    })
  }
}
