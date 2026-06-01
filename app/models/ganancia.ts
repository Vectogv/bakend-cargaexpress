import { DateTime } from 'luxon'
import { BaseModel, column, belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import Conductor from './conductor.js'
import Viaje from './viaje.js'
import { ApiProperty } from '@foadonis/openapi/decorators'

export default class Ganancia extends BaseModel {
  static $columns = [
    'id',
    'conductorId',
    'viajeId',
    'monto',
    'montoBruto',
    'comision',
    'montoNeto',
    'comisionPagada',
    'comisionPagadaAt',
    'createdAt',
  ] as const
  $columns = Ganancia.$columns

  @ApiProperty()
  @column({ isPrimary: true })
  declare id: number

  @ApiProperty()
  @column()
  declare conductorId: number

  @ApiProperty()
  @column()
  declare viajeId: number | null

  @ApiProperty()
  @column()
  declare monto: number

  @ApiProperty()
  @column()
  declare montoBruto: number | null

  @ApiProperty()
  @column()
  declare comision: number | null

  @ApiProperty()
  @column()
  declare montoNeto: number | null

  @ApiProperty()
  @column()
  declare comisionPagada: boolean

  @ApiProperty()
  @column.dateTime()
  declare comisionPagadaAt: DateTime | null

  @ApiProperty()
  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @belongsTo(() => Conductor, { foreignKey: 'conductorId' })
  declare conductor: BelongsTo<typeof Conductor>

  @belongsTo(() => Viaje, { foreignKey: 'viajeId' })
  declare viaje: BelongsTo<typeof Viaje>
}
