import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Monto que cubre el comprobante de pago en revisión (la deuda al subirlo) y
 * cuándo se subió. Al aprobar solo se descuenta ese monto: las comisiones de
 * viajes terminados durante la revisión siguen como deuda.
 *
 * Aditiva y nullable: los comprobantes ya en revisión quedan con NULL y al
 * aprobarlos se borra toda la deuda, como antes.
 */
export default class extends BaseSchema {
  protected tableName = 'users'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.decimal('monto_comprobante', 10, 2).nullable()
      table.timestamp('comprobante_subido_at').nullable()
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('monto_comprobante')
      table.dropColumn('comprobante_subido_at')
    })
  }
}
