import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'viajes'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      // PIN de 4 dígitos que el cliente entrega a quien recibe la carga; el
      // conductor lo escribe al cerrar cerca del destino.
      table.string('pin_entrega', 4).nullable()
      table.string('foto_recogida').nullable()
      table.string('receptor_nombre').nullable()
      table.string('receptor_telefono', 30).nullable()
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('pin_entrega')
      table.dropColumn('foto_recogida')
      table.dropColumn('receptor_nombre')
      table.dropColumn('receptor_telefono')
    })
  }
}
