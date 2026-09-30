import { BaseSchema } from '@adonisjs/lucid/schema'

/** Comentarios de los conductores debajo de los anuncios del Grupo de conductores. */
export default class extends BaseSchema {
  protected tableName = 'aviso_comentarios'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table.integer('aviso_id').notNullable().unsigned().references('id').inTable('avisos').onDelete('CASCADE')
      table.integer('autor_id').notNullable().unsigned().references('id').inTable('users').onDelete('CASCADE')
      table.text('contenido').notNullable()
      table.timestamp('created_at').notNullable()
      table.index(['aviso_id'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
