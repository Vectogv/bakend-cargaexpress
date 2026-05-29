import type Conductor from '#models/conductor'
import { BaseTransformer } from '@adonisjs/core/transformers'

export default class ConductorTransformer extends BaseTransformer<Conductor> {
  toObject() {
    return this.pick(this.resource, [
      'cedula',
      'placa',
      'tipoVehiculo',
      'capacidad',
      'fotoConductor',
      'fotoVehiculo',
      'calificacion',
      'totalViajes',
      'horasActivo',
      'online',
    ])
  }
}
