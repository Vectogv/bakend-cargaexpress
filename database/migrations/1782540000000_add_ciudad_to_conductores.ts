import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Agrega la columna ciudad a conductores para que los moderadores
 * (de Popayán, Cali, Pasto, etc.) gestionen únicamente los conductores
 * de su respectiva ciudad.
 */
export default class extends BaseSchema {
  protected tableName = 'conductores'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.string('ciudad', 100).nullable()
    })
    this.schema.raw('CREATE INDEX idx_conductores_ciudad ON conductores (ciudad)')
  }

  async down() {
    this.schema.raw('DROP INDEX IF EXISTS idx_conductores_ciudad')
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('ciudad')
    })
  }
}