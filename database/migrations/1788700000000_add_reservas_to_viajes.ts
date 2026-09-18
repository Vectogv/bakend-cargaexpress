import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'viajes'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      // 'inmediata' | 'programada'
      table.string('tipo_programacion', 20).notNullable().defaultTo('inmediata')
      // Fecha/hora elegidas por el cliente (se guardan como texto para evitar
      // diferencias de driver entre sqlite/mysql/pg en columnas date/time).
      table.string('fecha_programada', 10).nullable()
      table.string('hora_programada', 5).nullable()
      // Momento exacto (UTC) en el que el scheduler debe iniciar la búsqueda.
      // Se calcula al crear la reserva como horaProgramada - dispatchLead.
      table.timestamp('activacion_at').nullable()
      // Evita reenviar el recordatorio "tu viaje es mañana".
      table.boolean('recordatorio_enviado').notNullable().defaultTo(false)
    })

    this.schema.raw(
      'CREATE INDEX idx_viajes_programados_activacion ON viajes (tipo_programacion, estado, activacion_at)'
    )
  }

  async down() {
    this.schema.raw('DROP INDEX IF EXISTS idx_viajes_programados_activacion')
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('tipo_programacion')
      table.dropColumn('fecha_programada')
      table.dropColumn('hora_programada')
      table.dropColumn('activacion_at')
      table.dropColumn('recordatorio_enviado')
    })
  }
}
