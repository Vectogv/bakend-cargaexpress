import { BaseSchema } from '@adonisjs/lucid/schema'

/** La app abre el viaje o el ticket al tocar el aviso de la bandeja. */
export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('notificaciones', (t) => {
      t.integer('viaje_id').unsigned().nullable()
      t.integer('ticket_id').unsigned().nullable()
    })
  }

  async down() {
    this.schema.alterTable('notificaciones', (t) => {
      t.dropColumn('viaje_id')
      t.dropColumn('ticket_id')
    })
  }
}
