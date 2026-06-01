import { DateTime } from 'luxon'
import { BaseModel, column, belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import User from './user.js'
import Conductor from './conductor.js'
import { ApiProperty } from '@foadonis/openapi/decorators'

export default class Viaje extends BaseModel {
  static $columns = [
    'id',
    'clienteId',
    'conductorId',
    'estado',
    'origenDireccion',
    'origenLat',
    'origenLng',
    'destinoDireccion',
    'destinoLat',
    'destinoLng',
    'carga',
    'precioCliente',
    'precioEstimado',
    'precioFinal',
    'motivoCancelacion',
    'calificacionCliente',
    'fotoEntrega',
    'tiempoEstimadoMinutos',
    'createdAt',
    'aceptadoAt',
    'completadoAt',
    'canceladoAt',
    'enCursoAt',
    'finalizadoAt',
  ] as const
  $columns = Viaje.$columns

  @ApiProperty()
  @column({ isPrimary: true })
  declare id: number

  @ApiProperty()
  @column()
  declare clienteId: number

  @ApiProperty()
  @column()
  declare conductorId: number | null

  @ApiProperty()
  @column()
  declare estado: string

  @ApiProperty()
  @column()
  declare origenDireccion: string

  @ApiProperty()
  @column()
  declare origenLat: number

  @ApiProperty()
  @column()
  declare origenLng: number

  @ApiProperty()
  @column()
  declare destinoDireccion: string

  @ApiProperty()
  @column()
  declare destinoLat: number

  @ApiProperty()
  @column()
  declare destinoLng: number

  @ApiProperty()
  @column()
  declare carga: string | null

  @ApiProperty()
  @column()
  declare precioCliente: number | null

  @ApiProperty()
  @column()
  declare precioEstimado: number | null

  @ApiProperty()
  @column()
  declare precioFinal: number | null

  @ApiProperty()
  @column()
  declare motivoCancelacion: string | null

  @ApiProperty()
  @column()
  declare calificacionCliente: number | null

  @ApiProperty()
  @column()
  declare fotoEntrega: string | null

  @ApiProperty()
  @column()
  declare tiempoEstimadoMinutos: number | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime()
  declare aceptadoAt: DateTime | null

  @column.dateTime()
  declare completadoAt: DateTime | null

  @column.dateTime()
  declare canceladoAt: DateTime | null

  @column.dateTime()
  declare enCursoAt: DateTime | null

  @column.dateTime()
  declare finalizadoAt: DateTime | null

  @belongsTo(() => User, { foreignKey: 'clienteId' })
  declare cliente: BelongsTo<typeof User>

  @belongsTo(() => Conductor, { foreignKey: 'conductorId' })
  declare conductor: BelongsTo<typeof Conductor>
}
