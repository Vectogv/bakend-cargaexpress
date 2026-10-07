import { DateTime } from 'luxon'
import { BaseModel, column, belongsTo, hasOne } from '@adonisjs/lucid/orm'
import type { BelongsTo, HasOne } from '@adonisjs/lucid/types/relations'
import User from './user.js'
import Conductor from './conductor.js'
import Ganancia from './ganancia.js'
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
    'tipoProgramacion',
    'fechaProgramada',
    'horaProgramada',
    'activacionAt',
    'recordatorioEnviado',
    'avisoPospuestoEnviado',
    'precioCliente',
    'precioEstimado',
    'precioFinal',
    'motivoCancelacion',
    'calificacionCliente',
    'fotoEntrega',
    'fotoRecogida',
    'pinEntrega',
    'receptorNombre',
    'receptorTelefono',
    'tipoVehiculoRequerido',
    'plazoMinutos',
    'plazoEstado',
    'plazoSolicitadoAt',
    'busquedaEtapa',
    'busquedaEtapaEn',
    'precioSugeridoMin',
    'precioSugeridoMax',
    'busquedaHasta',
    'tiempoEstimadoMinutos',
    'createdAt',
    'aceptadoAt',
    'completadoAt',
    'canceladoAt',
    'enCursoAt',
    'finalizadoAt',
    'pendienteConfirmacionDesde',
    'moderadorNotificadoEn',
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
  @column({ consume: (v) => (v === null || v === undefined ? v : Number(v)) })
  declare origenLat: number

  @ApiProperty()
  @column({ consume: (v) => (v === null || v === undefined ? v : Number(v)) })
  declare origenLng: number

  @ApiProperty()
  @column()
  declare destinoDireccion: string

  @ApiProperty()
  @column({ consume: (v) => (v === null || v === undefined ? v : Number(v)) })
  declare destinoLat: number

  @ApiProperty()
  @column({ consume: (v) => (v === null || v === undefined ? v : Number(v)) })
  declare destinoLng: number

  @ApiProperty()
  @column()
  declare carga: string | null

  /** 'inmediata' | 'programada' */
  @ApiProperty()
  @column()
  declare tipoProgramacion: string

  /** Fecha elegida por el cliente en formato YYYY-MM-DD (solo reservas). */
  @ApiProperty()
  @column()
  declare fechaProgramada: string | null

  /** Hora elegida por el cliente en formato HH:mm (solo reservas). */
  @ApiProperty()
  @column()
  declare horaProgramada: string | null

  /** Momento en que el scheduler inicia la búsqueda de conductor. */
  @ApiProperty()
  @column.dateTime()
  declare activacionAt: DateTime | null

  @column()
  declare recordatorioEnviado: boolean

  /** Evita repetir el aviso "tu reserva espera" en cada pasada del scheduler (cada 60s). */
  @column()
  declare avisoPospuestoEnviado: boolean

  @ApiProperty()
  @column({ consume: (v) => (v === null || v === undefined ? v : Number(v)) })
  declare precioCliente: number | null

  @ApiProperty()
  @column({ consume: (v) => (v === null || v === undefined ? v : Number(v)) })
  declare precioEstimado: number | null

  @ApiProperty()
  @column({ consume: (v) => (v === null || v === undefined ? v : Number(v)) })
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
  declare fotoRecogida: string | null

  /** 4 dígitos, se genera al aceptar la oferta. Solo lo ve el cliente. */
  @column()
  declare pinEntrega: string | null

  @ApiProperty()
  @column()
  declare receptorNombre: string | null

  @ApiProperty()
  @column()
  declare receptorTelefono: string | null

  /** Texto libre (ej. "Camioneta", "Furgón cerrado"), opcional e informativo. */
  @ApiProperty()
  @column()
  declare tipoVehiculoRequerido: string | null

  /** "Pedir más plazo" (solo reservas asignadas): 15 | 30 | 60, una sola vez. */
  @ApiProperty()
  @column()
  declare plazoMinutos: number | null

  /** 'pendiente' | 'aceptado' | 'rechazado' | 'expirado' (sin respuesta en 5 min: cuenta como rechazo) */
  @ApiProperty()
  @column()
  declare plazoEstado: string | null

  @ApiProperty()
  @column.dateTime()
  declare plazoSolicitadoAt: DateTime | null

  /** Escalera de acompañamiento: 'publicado' | 'ampliada' | 'sugerencia' | 'cierre' (null = sin escalera). */
  @ApiProperty()
  @column()
  declare busquedaEtapa: string | null

  @ApiProperty()
  @column.dateTime()
  declare busquedaEtapaEn: DateTime | null

  @ApiProperty()
  @column()
  declare precioSugeridoMin: number | null

  @ApiProperty()
  @column()
  declare precioSugeridoMax: number | null

  /** Corte de la cancelación automática de la búsqueda (null = regla vieja por BUSQUEDA_TIMEOUT_MIN). */
  @ApiProperty()
  @column.dateTime()
  declare busquedaHasta: DateTime | null

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

  @column.dateTime()
  declare pendienteConfirmacionDesde: DateTime | null

  @column.dateTime()
  declare moderadorNotificadoEn: DateTime | null

  @belongsTo(() => User, { foreignKey: 'clienteId' })
  declare cliente: BelongsTo<typeof User>

  @belongsTo(() => Conductor, { foreignKey: 'conductorId' })
  declare conductor: BelongsTo<typeof Conductor>

  /** Ganancia del conductor al finalizar (trae la comisión real cobrada). */
  @hasOne(() => Ganancia, { foreignKey: 'viajeId' })
  declare ganancia: HasOne<typeof Ganancia>
}
