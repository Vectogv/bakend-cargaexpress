import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'configuracion_plataforma'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      // Mismos valores que hoy están escritos a mano en support_controller.ts:
      // el gerente los podrá editar desde la web sin tocar código.
      table.string('soporte_telefono').nullable().defaultTo('+58 800-CARGA')
      table.string('soporte_email').nullable().defaultTo('soporte@cargaexpress.com')
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('soporte_telefono')
      table.dropColumn('soporte_email')
    })
  }
}
