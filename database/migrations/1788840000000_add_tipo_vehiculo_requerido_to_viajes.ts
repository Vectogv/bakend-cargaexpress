import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'viajes'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      // Tipo de vehículo que el cliente pide (opcional, texto libre: "Carro",
      // "Camioneta", "Furgón cerrado", "Estacas"). Puramente informativo: todos
      // los conductores ven la misma solicitud con esta etiqueta, no filtra ni
      // oculta el viaje a nadie.
      table.string('tipo_vehiculo_requerido').nullable()
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('tipo_vehiculo_requerido')
    })
  }
}
