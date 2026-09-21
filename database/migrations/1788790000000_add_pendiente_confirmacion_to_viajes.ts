import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'viajes'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.timestamp('pendiente_confirmacion_desde').nullable()
      table.timestamp('moderador_notificado_en').nullable()
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('pendiente_confirmacion_desde')
      table.dropColumn('moderador_notificado_en')
    })
  }
}