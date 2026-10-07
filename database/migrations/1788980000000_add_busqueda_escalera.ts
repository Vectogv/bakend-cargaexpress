import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Escalera de acompañamiento para viajes sin ofertas: etapa de la búsqueda,
 * precio sugerido y corte de la cancelación automática. En
 * configuracion_plataforma, los tiempos/radios/porcentajes editables (`escalera`).
 */
export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('viajes', (table) => {
      // 'publicado' | 'ampliada' | 'sugerencia' | 'cierre' (null = viaje sin escalera)
      table.string('busqueda_etapa', 20).nullable()
      table.timestamp('busqueda_etapa_en').nullable()
      table.integer('precio_sugerido_min').nullable()
      table.integer('precio_sugerido_max').nullable()
      // Corte de la cancelación automática (BusquedaTimeoutService).
      table.timestamp('busqueda_hasta').nullable()
    })
    this.schema.alterTable('configuracion_plataforma', (table) => {
      table.json('escalera').nullable()
    })
  }

  async down() {
    this.schema.alterTable('viajes', (table) => {
      table.dropColumn('busqueda_etapa')
      table.dropColumn('busqueda_etapa_en')
      table.dropColumn('precio_sugerido_min')
      table.dropColumn('precio_sugerido_max')
      table.dropColumn('busqueda_hasta')
    })
    this.schema.alterTable('configuracion_plataforma', (table) => {
      table.dropColumn('escalera')
    })
  }
}
