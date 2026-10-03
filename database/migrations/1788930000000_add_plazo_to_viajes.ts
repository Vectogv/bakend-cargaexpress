import { BaseSchema } from '@adonisjs/lucid/schema'

/** "Pedir más plazo": el conductor asignado a una reserva pide +15/+30/+60 min, una sola vez. */
export default class extends BaseSchema {
  protected tableName = 'viajes'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.integer('plazo_minutos').nullable()
      // 'pendiente' | 'aceptado' | 'rechazado'
      table.string('plazo_estado', 20).nullable()
      table.timestamp('plazo_solicitado_at').nullable()
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('plazo_minutos')
      table.dropColumn('plazo_estado')
      table.dropColumn('plazo_solicitado_at')
    })
  }
}
