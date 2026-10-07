import { BaseSchema } from '@adonisjs/lucid/schema'
import { baseCodigo, codigoLibre } from '#services/codigo_referido'

/**
 * Programa de referidos (fase 1): código del conductor, referidos, cupones de
 * comisión, el cupón usado en cada ganancia y la configuración editable
 * (`configuracion_plataforma.referidos`, ver referidos_service).
 */
export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('conductores', (table) => {
      table.string('codigo_referido', 12).nullable().unique()
    })

    this.schema.createTable('referidos', (table) => {
      table.increments('id')
      table.integer('referidor_conductor_id').unsigned().notNullable().references('id').inTable('conductores').onDelete('CASCADE')
      table.integer('invitado_conductor_id').unsigned().notNullable().unique().references('id').inTable('conductores').onDelete('CASCADE')
      // pendiente | activo | vencido | anulado
      table.string('estado', 20).notNullable().defaultTo('pendiente')
      // Se fijan al aprobar al invitado: desde ahí corren los días de la meta.
      table.timestamp('aprobado_en').nullable()
      table.timestamp('vence_en').nullable()
      table.timestamp('activado_en').nullable()
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()
      table.index(['referidor_conductor_id'])
    })

    this.schema.createTable('cupones_comision', (table) => {
      table.increments('id')
      table.integer('conductor_id').unsigned().notNullable().references('id').inTable('conductores').onDelete('CASCADE')
      table.integer('referido_id').unsigned().notNullable().references('id').inTable('referidos').onDelete('CASCADE')
      // invitado | referidor
      table.string('tipo', 20).notNullable()
      // Comisión que se cobra mientras dura el cupón (0-10).
      table.decimal('pct', 5, 2).notNullable()
      table.integer('usos_restantes').notNullable()
      table.timestamp('vence_en').nullable()
      // activo | anulado
      table.string('estado', 20).notNullable().defaultTo('activo')
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()
      table.index(['conductor_id', 'estado'])
    })

    this.schema.alterTable('ganancias', (table) => {
      table.integer('cupon_id').unsigned().nullable().references('id').inTable('cupones_comision').onDelete('SET NULL')
    })

    this.schema.alterTable('configuracion_plataforma', (table) => {
      table.json('referidos').nullable()
    })

    // Código para los conductores que ya existen.
    this.defer(async (db) => {
      const filas = await db
        .from('conductores')
        .join('users', 'users.id', 'conductores.usuario_id')
        .whereNull('conductores.codigo_referido')
        .select('conductores.id', 'conductores.placa', 'users.nombre')
      const usados = new Set<string>()
      for (const fila of filas) {
        const codigo = codigoLibre(baseCodigo(fila.nombre, fila.placa), usados)
        usados.add(codigo)
        await db.from('conductores').where('id', fila.id).update({ codigo_referido: codigo })
      }
    })
  }

  async down() {
    this.schema.alterTable('configuracion_plataforma', (table) => {
      table.dropColumn('referidos')
    })
    this.schema.alterTable('ganancias', (table) => {
      table.dropColumn('cupon_id')
    })
    this.schema.dropTable('cupones_comision')
    this.schema.dropTable('referidos')
    this.schema.alterTable('conductores', (table) => {
      table.dropColumn('codigo_referido')
    })
  }
}
