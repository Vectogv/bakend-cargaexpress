import { DateTime } from 'luxon'
import { BaseModel, column, belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import User from './user.js'
import { ApiProperty } from '@foadonis/openapi/decorators'

export default class Conductor extends BaseModel {
  static table = 'conductores'
  static $columns = [
    'id',
    'usuarioId',
    'cedula',
    'placa',
    'tipoVehiculo',
    'capacidad',
    'fotoConductor',
    'fotoVehiculo',
    'online',
    'calificacion',
    'totalViajes',
    'horasActivo',
    'ultimaUbicacionLat',
    'ultimaUbicacionLng',
    'createdAt',
  ] as const
  $columns = Conductor.$columns

  @ApiProperty()
  @column({ isPrimary: true })
  declare id: number

  @ApiProperty()
  @column()
  declare usuarioId: number

  @ApiProperty()
  @column()
  declare cedula: string

  @ApiProperty()
  @column()
  declare placa: string

  @ApiProperty()
  @column()
  declare tipoVehiculo: string | null

  @ApiProperty()
  @column()
  declare capacidad: string | null

  @ApiProperty()
  @column()
  declare fotoConductor: string | null

  @ApiProperty()
  @column()
  declare fotoVehiculo: string | null

  @ApiProperty()
  @column()
  declare online: boolean

  @ApiProperty()
  @column()
  declare calificacion: number

  @ApiProperty()
  @column()
  declare totalViajes: number

  @ApiProperty()
  @column()
  declare horasActivo: number

  @ApiProperty()
  @column()
  declare ultimaUbicacionLat: number | null

  @ApiProperty()
  @column()
  declare ultimaUbicacionLng: number | null

  @ApiProperty()
  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @belongsTo(() => User, { foreignKey: 'usuarioId' })
  declare usuario: BelongsTo<typeof User>
}
