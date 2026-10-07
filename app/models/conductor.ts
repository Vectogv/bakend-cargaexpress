import { DateTime } from 'luxon'
import { BaseModel, column, belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import User from './user.js'
import { ApiProperty } from '@foadonis/openapi/decorators'

/** pg devuelve `date` como Date JS; lo normalizamos a 'YYYY-MM-DD'. */
function fechaTexto(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null
  if (v instanceof Date) return DateTime.fromJSDate(v).toISODate()
  return String(v).slice(0, 10)
}

/** Apagado por ahora (decisión del gerente): si es true, aprobar a un conductor exige SOAT válido. */
export const SOAT_OBLIGATORIO = false

export default class Conductor extends BaseModel {
  static table = 'conductores'
  static $columns = [
    'id',
    'usuarioId',
    'cedula',
    'placa',
    'tipoVehiculo',
    'capacidad',
    'modeloVehiculo',
    'ciudad',
    'fotoConductor',
    'fotoVehiculo',
    'online',
    'calificacion',
    'totalViajes',
    'horasActivo',
    'ultimaUbicacionLat',
    'ultimaUbicacionLng',
    'estadoVerificacion',
    'fotoCedula',
    'fotoLicencia',
    'notaRechazo',
    'fotoCedulaReverso',
    'fotoTarjetaPropiedad',
    'fotoTecnomecanica',
    'tecnomecanicaVence',
    'fotoSoat',
    'soatVence',
    'excepcionSoatEstado',
    'excepcionSoatNota',
    'createdAt',
    'updatedAt',
    'ubicacionActualizadaEn',
    'penalizacionCancelacion',
    'codigoReferido',
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

  @column()
  declare modeloVehiculo: string | null

  @ApiProperty()
  @column()
  declare ciudad: string | null

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
  @column({
    consume: (v: unknown) => (v === null || v === undefined ? null : Number(v)),
  })
  declare calificacion: number | null

  /** Suma de penalizaciones por cancelar viajes asignados; se resta a `calificacion`. */
  @column({ consume: (v: unknown) => (v === null || v === undefined ? 0 : Number(v)) })
  declare penalizacionCancelacion: number

  @ApiProperty()
  @column()
  declare totalViajes: number

  @ApiProperty()
  @column({
    consume: (v: unknown) => (v === null || v === undefined ? null : Number(v)),
  })
  declare horasActivo: number | null

  @ApiProperty()
  @column()
  declare ultimaUbicacionLat: number | null

  @ApiProperty()
  @column()
  declare ultimaUbicacionLng: number | null

  @ApiProperty()
  @column()
  declare estadoVerificacion: string

  @ApiProperty()
  @column()
  declare fotoCedula: string | null

  @ApiProperty()
  @column()
  declare fotoLicencia: string | null

  @ApiProperty()
  @column()
  declare notaRechazo: string | null

  @column()
  declare fotoCedulaReverso: string | null

  @column()
  declare fotoTarjetaPropiedad: string | null

  @column()
  declare fotoTecnomecanica: string | null

  /** Fecha (YYYY-MM-DD) sin hora: se guarda y se lee como texto. */
  @column({ consume: fechaTexto, prepare: fechaTexto })
  declare tecnomecanicaVence: string | null

  @column()
  declare fotoSoat: string | null

  @column({ consume: fechaTexto, prepare: fechaTexto })
  declare soatVence: string | null

  /** null | pendiente | aprobada | rechazada */
  @column()
  declare excepcionSoatEstado: string | null

  @column()
  declare excepcionSoatNota: string | null

  /** SOAT vigente (vence hoy o después) o excepción aprobada por el admin. */
  get soatValido(): boolean {
    if (this.excepcionSoatEstado === 'aprobada') return true
    return !!this.fotoSoat && !!this.soatVence && this.soatVence >= DateTime.now().toISODate()!
  }

  /** Campos de los documentos nuevos, con las fotos firmadas, para perfil/admin. */
  documentosExtra(sign: (p: string | null) => string | null) {
    return {
      fotoCedulaReverso: sign(this.fotoCedulaReverso),
      fotoTarjetaPropiedad: sign(this.fotoTarjetaPropiedad),
      fotoTecnomecanica: sign(this.fotoTecnomecanica),
      tecnomecanicaVence: this.tecnomecanicaVence,
      fotoSoat: sign(this.fotoSoat),
      soatVence: this.soatVence,
      excepcionSoatEstado: this.excepcionSoatEstado,
      excepcionSoatNota: this.excepcionSoatNota,
    }
  }

  @ApiProperty()
  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime

  @column.dateTime()
  declare ubicacionActualizadaEn: DateTime | null

  /** Código que comparte para invitar a otros conductores (referidos_service). */
  @column()
  declare codigoReferido: string | null

  @belongsTo(() => User, { foreignKey: 'usuarioId' })
  declare usuario: BelongsTo<typeof User>
}
