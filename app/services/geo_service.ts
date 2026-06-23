import db from '@adonisjs/lucid/services/db'
import Viaje from '#models/viaje'
import Conductor from '#models/conductor'
import Oferta from '#models/oferta'

function haversineSql(latCol: string, lngCol: string, lat: number, lng: number, radioKm: number): string {
  return `(6371 * 2 * ASIN(SQRT(POWER(SIN(RADIANS(${latCol} - ${lat})), 2) + COS(RADIANS(${lat})) * COS(RADIANS(${latCol})) * POWER(SIN(RADIANS(${lngCol} - ${lng})), 2)))) <= ${radioKm}`
}

function distanciaSql(latCol: string, lngCol: string, lat: number, lng: number): string {
  return `ROUND(6371 * 2 * ASIN(SQRT(POWER(SIN(RADIANS(${latCol} - ${lat})), 2) + COS(RADIANS(${lat})) * COS(RADIANS(${latCol})) * POWER(SIN(RADIANS(${lngCol} - ${lng})), 2))), 2)`
}

export default class GeoService {
  static async obtenerViajesCercanos(lat: number, lng: number, radioKm: number = 5) {
    const ofertasAceptadas = await Oferta.query()
      .where('estado', 'aceptada')
      .select('viaje_id')

    const idsConOfertaAceptada = ofertasAceptadas.map((o) => o.viajeId)

    const viajes = await Viaje.query()
      .select(
        'viajes.*',
        db.raw(`${distanciaSql('viajes.origen_lat', 'viajes.origen_lng', lat, lng)} as distancia`)
      )
      .whereIn('estado', ['buscando_conductor', 'pendiente'])
      .whereNotIn('id', idsConOfertaAceptada)
      .whereRaw(haversineSql('viajes.origen_lat', 'viajes.origen_lng', lat, lng, radioKm))
      .preload('cliente', (q) => q.select('id', 'nombre', 'apellido', 'calificacion'))
      .limit(20)

    return viajes.map((v) => ({
      id: Number(v.id),
      estado: v.estado,
      precioEstimado: Number(v.precioEstimado),
      distancia: Number((v as any).$extras?.distancia || 0),
      tiempoEstimado: Number(v.tiempoEstimadoMinutos),
      carga: v.carga,
      descripcion: v.carga,
      createdAt: v.createdAt.toISO(),
      cliente: {
        id: Number(v.cliente.id),
        nombre: `${v.cliente.nombre || ''} ${v.cliente.apellido || ''}`.trim(),
        calificacion: Number(v.cliente.calificacion ?? 5.0),
      },
      origen: {
        direccion: v.origenDireccion,
        lat: Number(v.origenLat),
        lng: Number(v.origenLng),
      },
      destino: {
        direccion: v.destinoDireccion,
        lat: Number(v.destinoLat),
        lng: Number(v.destinoLng),
      },
    }))
  }

  static async obtenerConductoresCercanos(lat: number, lng: number, radioKm: number = 20) {
    const conductores = await Conductor.query()
      .select(
        'conductores.*',
        db.raw(`${distanciaSql('conductores.ultima_ubicacion_lat', 'conductores.ultima_ubicacion_lng', lat, lng)} as distancia`)
      )
      .where('online', true)
      .whereNotNull('ultimaUbicacionLat')
      .whereNotNull('ultimaUbicacionLng')
      .whereRaw(haversineSql('conductores.ultima_ubicacion_lat', 'conductores.ultima_ubicacion_lng', lat, lng, radioKm))
      .preload('usuario', (q) => q.select('id', 'nombre'))
      .limit(20)

    return conductores.map((c) => ({
      id: String(c.id),
      usuarioId: c.usuarioId,
      nombre: c.usuario.nombre,
      placa: c.placa,
      tipoVehiculo: c.tipoVehiculo,
      calificacion: c.calificacion,
      totalViajes: c.totalViajes,
      distancia: Number((c as any).$extras?.distancia || 0),
    }))
  }
}
