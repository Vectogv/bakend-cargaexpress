import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'disputas'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.string('numero').unique().nullable()
      table.string('problema').nullable()
      table.text('descripcion').nullable()
      table.decimal('reembolso', 10, 2).nullable()
      table.text('comentario_admin').nullable()
      table.json('fotos').nullable()
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('numero')
      table.dropColumn('problema')
      table.dropColumn('descripcion')
      table.dropColumn('reembolso')
      table.dropColumn('comentario_admin')
      table.dropColumn('fotos')
    })
  }
}
