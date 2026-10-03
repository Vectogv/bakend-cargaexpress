import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Registro del cliente paso a paso: cédula (opcional) y si terminó el
 * asistente. Los usuarios que ya existen quedan completos (default true).
 */
export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('users', (t) => {
      t.string('cedula', 20).nullable()
      t.boolean('registro_completo').notNullable().defaultTo(true)
    })
  }

  async down() {
    this.schema.alterTable('users', (t) => {
      t.dropColumn('cedula')
      t.dropColumn('registro_completo')
    })
  }
}
