import { BaseSchema } from '@adonisjs/lucid/schema'

/** Registro unificado: modelo del vehiculo y fecha de aceptacion de terminos. */
export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('conductores', (t) => t.string('modelo_vehiculo', 50).nullable())
    this.schema.alterTable('users', (t) => t.timestamp('terminos_aceptados_at').nullable())
  }

  async down() {
    this.schema.alterTable('conductores', (t) => t.dropColumn('modelo_vehiculo'))
    this.schema.alterTable('users', (t) => t.dropColumn('terminos_aceptados_at'))
  }
}
