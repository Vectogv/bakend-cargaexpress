import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'
import { jsonColumn } from './json_column.js'

export default class ConfiguracionPlataforma extends BaseModel {
  static table = 'configuracion_plataforma'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare nequiNumero: string | null

  @column()
  declare nequiNombre: string | null

  @column(jsonColumn)
  declare zonasCobertura: any

  @column()
  declare bannerActivo: boolean

  @column()
  declare bannerImagenUrl: string | null

  @column()
  declare bannerLink: string | null

  @column()
  declare bannerTexto: string | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime

  /**
   * Fila única de configuración, siempre la misma.
   *
   * Antes se usaba `ConfiguracionPlataforma.first()`, que es un LIMIT 1 SIN ORDER BY.
   * En SQLite devuelve siempre la misma fila, pero PostgreSQL no lo garantiza: al
   * actualizar una fila, esta se reescribe al final del heap, así que una lectura
   * posterior puede devolver otra distinta. Si la tabla tenía más de una fila (algo
   * que nada impedía), se guardaba en una y se leía de otra: las zonas de cobertura
   * se "perdían" al recargar aunque el guardado respondiera correctamente.
   *
   * Ordenando por id, lecturas y escrituras van siempre a la fila más antigua.
   */
  static async unica() {
    return this.query().orderBy('id', 'asc').first()
  }

  /** Igual que `unica()`, creando la fila si la tabla está vacía. */
  static async unicaOCrear() {
    return (await this.unica()) ?? (await this.create({}))
  }
}
