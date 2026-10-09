import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Auditoría del SOS: toda alerta resuelta debe quedar con un tipo de caso,
 * además de la observación (gestión realizada) que ya existía.
 */
export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('alertas_emergencia', (table) => {
      table.string('tipo_cierre', 30).nullable()
    })
  }

  async down() {
    this.schema.alterTable('alertas_emergencia', (table) => {
      table.dropColumn('tipo_cierre')
    })
  }
}
