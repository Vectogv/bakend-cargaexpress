import { BaseSchema } from '@adonisjs/lucid/schema'

/** Fecha en que el anuncio deja de mostrarse solo (null = sin límite). */
export default class extends BaseSchema {
  protected tableName = 'configuracion_plataforma'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.timestamp('banner_hasta').nullable()
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('banner_hasta')
    })
  }
}
