import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Rol de LÍDER DE CONDUCTORES.
 *
 * Agrega la columna es_lider a users. El middleware `leader_middleware` y
 * `leader_permission_middleware` la leen vía `user.$original.esLider` para
 * autorizar el prefijo /api/leader/*. Sin esta columna el rol no existía en
 * la BD y el endpoint PUT /api/admin/users/:id/leader no tenía método.
 */
export default class extends BaseSchema {
  protected tableName = 'users'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.boolean('es_lider').notNullable().defaultTo(false)
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('es_lider')
    })
  }
}