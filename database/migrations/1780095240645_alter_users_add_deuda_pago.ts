import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'users'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.decimal('monto_deuda', 10, 2).nullable()
      table.timestamp('deuda_fecha_limite').nullable()
      table.string('estado_cuenta').notNullable().defaultTo('activa')
      table.string('comprobante_pago').nullable()
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('monto_deuda')
      table.dropColumn('deuda_fecha_limite')
      table.dropColumn('estado_cuenta')
      table.dropColumn('comprobante_pago')
    })
  }
}
