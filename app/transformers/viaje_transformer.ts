import type Viaje from '#models/viaje'
import { BaseTransformer } from '@adonisjs/core/transformers'

export default class ViajeTransformer extends BaseTransformer<Viaje> {
  toObject() {
    return this.pick(this.resource, [
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
      'precioEstimado',
      'precioFinal',
      'motivoCancelacion',
      'createdAt',
      'aceptadoAt',
      'completadoAt',
      'canceladoAt',
    ])
  }
}
