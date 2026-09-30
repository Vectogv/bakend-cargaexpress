import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'conductores'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.string('foto_cedula_reverso').nullable()
      table.string('foto_tarjeta_propiedad').nullable()
      table.string('foto_tecnomecanica').nullable()
      table.date('tecnomecanica_vence').nullable()
      table.string('foto_soat').nullable()
      table.date('soat_vence').nullable()
      // null | pendiente | aprobada | rechazada
      table.string('excepcion_soat_estado', 20).nullable()
      table.text('excepcion_soat_nota').nullable()
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('foto_cedula_reverso')
      table.dropColumn('foto_tarjeta_propiedad')
      table.dropColumn('foto_tecnomecanica')
      table.dropColumn('tecnomecanica_vence')
      table.dropColumn('foto_soat')
      table.dropColumn('soat_vence')
      table.dropColumn('excepcion_soat_estado')
      table.dropColumn('excepcion_soat_nota')
    })
  }
}
