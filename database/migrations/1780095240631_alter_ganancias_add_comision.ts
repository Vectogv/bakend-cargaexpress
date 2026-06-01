import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'ganancias'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.decimal('monto_bruto', 10, 2).nullable().after('monto')
      table.decimal('comision', 10, 2).nullable().after('monto_bruto')
      table.decimal('monto_neto', 10, 2).nullable().after('comision')
      table.boolean('comision_pagada').notNullable().defaultTo(false).after('monto_neto')
      table.timestamp('comision_pagada_at').nullable().after('comision_pagada')
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('monto_bruto')
      table.dropColumn('comision')
      table.dropColumn('monto_neto')
      table.dropColumn('comision_pagada')
      table.dropColumn('comision_pagada_at')
    })
  }
}
