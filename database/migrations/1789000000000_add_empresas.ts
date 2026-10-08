import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Cuentas de empresa (fase 1): la empresa con sus documentos y aprobación,
 * `users.empresa_id` (dueño y empleados, siguen con rol cliente) y
 * `viajes.empresa_id` (se fija al publicar para que el reporte no cambie si
 * después se quita a un empleado). Reglas en empresa_service.
 */
export default class extends BaseSchema {
  async up() {
    this.schema.createTable('empresas', (table) => {
      table.increments('id')
      table.integer('owner_user_id').unsigned().notNullable().unique().references('id').inTable('users').onDelete('CASCADE')
      table.string('nombre', 150).notNullable()
      // Solo dígitos (sin puntos ni guion).
      table.string('nit', 20).notNullable().unique()
      table.string('direccion', 200).nullable()
      table.string('telefono', 20).nullable()
      table.string('foto_rut', 255).nullable()
      table.string('foto_camara_comercio', 255).nullable()
      // pendiente | aprobado | rechazado
      table.string('estado_verificacion', 20).notNullable().defaultTo('pendiente')
      table.text('nota_rechazo').nullable()
      table.string('codigo_union', 8).notNullable().unique()
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()
    })

    this.schema.alterTable('users', (table) => {
      table.integer('empresa_id').unsigned().nullable().references('id').inTable('empresas').onDelete('SET NULL')
    })

    this.schema.alterTable('viajes', (table) => {
      table.integer('empresa_id').unsigned().nullable().references('id').inTable('empresas').onDelete('SET NULL')
      table.index(['empresa_id', 'estado'])
    })
  }

  async down() {
    this.schema.alterTable('viajes', (table) => {
      table.dropIndex(['empresa_id', 'estado'])
      table.dropColumn('empresa_id')
    })
    this.schema.alterTable('users', (table) => {
      table.dropColumn('empresa_id')
    })
    this.schema.dropTable('empresas')
  }
}
