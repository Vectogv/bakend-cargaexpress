import { DateTime } from 'luxon'

/** Campos de `conductores` que dejan al conductor con todos los documentos requeridos para aprobarlo. */
export function documentosCompletos() {
  const vence = DateTime.now().plus({ months: 6 }).toISODate()!
  return {
    fotoLicencia: 'uploads/licencia.png',
    fotoTecnomecanica: 'uploads/tecno.png',
    tecnomecanicaVence: vence,
    fotoSoat: 'uploads/soat.png',
    soatVence: vence,
    fotoTarjetaPropiedad: 'uploads/tarjeta.png',
    fotoVehiculo: 'uploads/vehiculo.png',
    fotoConductor: 'uploads/conductor.png',
  }
}
