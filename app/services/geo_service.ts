import Viaje from '#models/viaje'
import Conductor from '#models/conductor'
import Oferta from '#models/oferta'

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
    const ofertasAceptadas = await Oferta.query()
      .where('estado', 'aceptada')
      .select('viaje_id')

    const idsConOfertaAceptada = ofertasAceptadas.map((o) => o.viajeId)

    const viajes = await Viaje.query()
      .whereIn('estado', ['buscando_conductor', 'pendiente'])
      .whereNotIn('id', idsConOfertaAceptada)
      .preload('cliente')

    return viajes
      .filter((v) => {
        if (v.origenLat == null || v.origenLng == null) return false
        return haversine({ lat, lng }, { lat: v.origenLat, lng: v.origenLng }) <= radioKm
      })
      .map((v) => {
        const dist = v.origenLat != null && v.origenLng != null
          ? Math.round(haversine({ lat, lng }, { lat: v.origenLat, lng: v.origenLng }) * 100) / 100
          : 0
        return {
          id: Number(v.id),
          estado: v.estado,
          precioEstimado: Number(v.precioEstimado),
          distancia: dist,
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
        }
      })
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
