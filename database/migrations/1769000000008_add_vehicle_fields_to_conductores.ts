import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'conductores'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.string('tipo_vehiculo', 50).nullable().after('placa')
      table.string('capacidad', 50).nullable().after('tipo_vehiculo')
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('tipo_vehiculo')
      table.dropColumn('capacidad')
    })
  }
}
