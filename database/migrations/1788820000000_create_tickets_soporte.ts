import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Tickets de soporte: un usuario (cliente o conductor) abre un caso, opcionalmente
 * ligado a un viaje, y lo atiende un moderador de su zona o el admin mediante un
 * hilo de mensajes (tabla `ticket_mensajes`).
 */
export default class extends BaseSchema {
  async up() {
    this.schema.createTable('tickets_soporte', (table) => {
      table.increments('id')
      table
        .integer('usuario_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('users')
        .onDelete('CASCADE')
      table
        .integer('viaje_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('viajes')
        .onDelete('SET NULL')
      table.string('categoria', 30).notNullable()
      table.string('asunto', 150).notNullable()
      table.text('descripcion').notNullable()
      table.string('adjunto', 500).nullable()
      table.string('estado', 20).notNullable().defaultTo('abierto')
      table
        .integer('moderador_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('users')
        .onDelete('SET NULL')
      // Clave de zona (ver coverage_service.claveDe): la del viaje o la del usuario.
      table.string('zona', 100).nullable()
      table.timestamp('ultimo_mensaje_at').nullable()
      table.timestamp('resuelto_at').nullable()
      table.timestamp('cerrado_at').nullable()
      table.timestamps(true, true)

      table.index(['usuario_id'], 'idx_tickets_soporte_usuario')
      table.index(['moderador_id'], 'idx_tickets_soporte_moderador')
      table.index(['zona', 'estado'], 'idx_tickets_soporte_zona_estado')
    })

    this.schema.createTable('ticket_mensajes', (table) => {
      table.increments('id')
      table
        .integer('ticket_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('tickets_soporte')
        .onDelete('CASCADE')
      table
        .integer('autor_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('users')
        .onDelete('CASCADE')
      // 'usuario' | 'moderador' | 'admin'
      table.string('rol_autor', 20).notNullable()
      table.text('mensaje').notNullable()
      table.string('adjunto', 500).nullable()
      table.timestamp('created_at').notNullable()

      table.index(['ticket_id'], 'idx_ticket_mensajes_ticket')
    })
  }

  async down() {
    this.schema.dropTable('ticket_mensajes')
    this.schema.dropTable('tickets_soporte')
  }
}
