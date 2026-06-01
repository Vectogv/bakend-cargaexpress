import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'configuracion_plataforma'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.boolean('banner_activo').notNullable().defaultTo(false)
      table.string('banner_imagen_url').nullable()
      table.string('banner_link').nullable()
      table.string('banner_texto').nullable()
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('banner_activo')
      table.dropColumn('banner_imagen_url')
      table.dropColumn('banner_link')
      table.dropColumn('banner_texto')
    })
  }
}
