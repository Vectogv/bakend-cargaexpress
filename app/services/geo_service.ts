import Viaje from '#models/viaje'
import Conductor from '#models/conductor'

interface Coord {
  lat: number
  lng: number
}

function haversine(a: Coord, b: Coord): number {
  const R = 6371
  const dLat = ((b.lat - a.lat) * Math.PI) / 180
  const dLng = ((b.lng - a.lng) * Math.PI) / 180
  const lat1 = (a.lat * Math.PI) / 180
  const lat2 = (b.lat * Math.PI) / 180
  const sinLat = Math.sin(dLat / 2)
  const sinLng = Math.sin(dLng / 2)
  const h = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))
}

export default class GeoService {
  static async obtenerViajesCercanos(lat: number, lng: number, radioKm: number = 5) {
    const viajes = await Viaje.query().where('estado', 'buscando_conductor').preload('cliente')
    return viajes
      .filter((v) => {
        if (v.origenLat == null || v.origenLng == null) return false
        return haversine({ lat, lng }, { lat: v.origenLat, lng: v.origenLng }) <= radioKm
      })
      .map((v) => ({
        id: String(v.id),
        cliente: {
          nombre: `${v.cliente.nombre || ''} ${v.cliente.apellido || ''}`.trim(),
          reputacion: v.cliente.reputacion,
          visibilidad: v.cliente.visibilidad,
          totalViajes: v.cliente.totalViajes,
          calificacion: v.cliente.calificacion,
        },
        origen: { direccion: v.origenDireccion, lat: v.origenLat, lng: v.origenLng },
        destino: { direccion: v.destinoDireccion, lat: v.destinoLat, lng: v.destinoLng },
        carga: v.carga,
        precioEstimado: v.precioEstimado,
        distancia: v.origenLat != null && v.origenLng != null
          ? Math.round(haversine({ lat, lng }, { lat: v.origenLat, lng: v.origenLng }) * 100) / 100
          : 0,
        createdAt: v.createdAt.toISO(),
      }))
  }

  static async obtenerConductoresCercanos(lat: number, lng: number, radioKm: number = 20) {
    const conductores = await Conductor.query()
      .where('online', true)
      .whereNotNull('ultimaUbicacionLat')
      .whereNotNull('ultimaUbicacionLng')
      .preload('usuario')
    return conductores
      .filter((c) => {
        if (c.ultimaUbicacionLat == null || c.ultimaUbicacionLng == null) return false
        return haversine({ lat, lng }, { lat: c.ultimaUbicacionLat, lng: c.ultimaUbicacionLng }) <= radioKm
      })
      .map((c) => ({
        id: String(c.id),
        usuarioId: c.usuarioId,
        nombre: c.usuario.nombre,
        placa: c.placa,
        tipoVehiculo: c.tipoVehiculo,
        calificacion: c.calificacion,
        totalViajes: c.totalViajes,
        distancia: c.ultimaUbicacionLat != null && c.ultimaUbicacionLng != null
          ? Math.round(haversine({ lat, lng }, { lat: c.ultimaUbicacionLat, lng: c.ultimaUbicacionLng }) * 100) / 100
          : 0,
      }))
  }
}
