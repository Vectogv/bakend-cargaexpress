import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Panel de moderación:
 *  - `inactividad_dias`: días sin viajes a partir de los cuales un conductor
 *    cuenta como inactivo (editable por gerencia).
 *  - `viaje_recorrido`: puntos reales del conductor durante un viaje (uno cada
 *    15 s o 30 m), para dibujar el recorrido en el panel.
 */
export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('configuracion_plataforma', (table) => {
      table.integer('inactividad_dias').notNullable().defaultTo(7)
    })

    this.schema.createTable('viaje_recorrido', (table) => {
      table.increments('id')
      table.integer('viaje_id').unsigned().notNullable().references('id').inTable('viajes').onDelete('CASCADE')
      table.decimal('lat', 10, 7).notNullable()
      table.decimal('lng', 10, 7).notNullable()
      table.timestamp('created_at').notNullable()
      table.index(['viaje_id', 'created_at'])
    })
  }

  async down() {
    this.schema.dropTable('viaje_recorrido')
    this.schema.alterTable('configuracion_plataforma', (table) => {
      table.dropColumn('inactividad_dias')
    })
  }
}
