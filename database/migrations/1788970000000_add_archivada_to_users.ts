import { BaseSchema } from '@adonisjs/lucid/schema'

/** Cuenta archivada: estado_cuenta = 'archivada' + fecha. No se borra nada. */
export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('users', (t) => {
      t.timestamp('archivada_at').nullable()
    })
  }

  async down() {
    this.schema.alterTable('users', (t) => {
      t.dropColumn('archivada_at')
    })
  }
}
