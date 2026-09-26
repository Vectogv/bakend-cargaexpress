import db from '@adonisjs/lucid/services/db'
import Viaje from '#models/viaje'
import Conductor from '#models/conductor'
import Oferta from '#models/oferta'

/** Distancia haversine en kilómetros. */
export function distanciaKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLng = ((lng2 - lng1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

function haversineSql(latCol: string, lngCol: string, lat: number, lng: number, radioKm: number): string {
  return `(6371 * 2 * ASIN(SQRT(POWER(SIN(RADIANS(${latCol} - ${lat})), 2) + COS(RADIANS(${lat})) * COS(RADIANS(${latCol})) * POWER(SIN(RADIANS(${lngCol} - ${lng})), 2)))) <= ${radioKm}`
}

function distanciaSql(latCol: string, lngCol: string, lat: number, lng: number): string {
  return `(6371 * 2 * ASIN(SQRT(POWER(SIN(RADIANS(${latCol} - ${lat})), 2) + COS(RADIANS(${lat})) * COS(RADIANS(${latCol})) * POWER(SIN(RADIANS(${lngCol} - ${lng})), 2))))`
}

/**
 * Normaliza `zonas_cobertura` a un array. En MySQL/Postgres la columna json
 * llega ya como objeto; en SQLite llega como texto, por eso se intenta parsear.
 */
export function normalizarZonas(zonas: unknown): any[] {
  if (!zonas) return []
  if (Array.isArray(zonas)) return zonas
  if (typeof zonas === 'string') {
    try {
      const parsed = JSON.parse(zonas)
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }
  return []
}

export default class GeoService {
  /**
   * Valida que una coordenada esté dentro de las zonas de cobertura activas.
   * Si no hay zonas configuradas, se considera cubierta. Delegado a CoverageService
   * (import dinámico para evitar la dependencia circular con este módulo).
   */
  static async validarCobertura(lat: number, lng: number): Promise<boolean> {
    const { default: CoverageService } = await import('#services/coverage_service')
    return CoverageService.estaCubierto(lat, lng)
  }

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
      id: String(v.id),
      _id: String(v.id),
      estado: v.estado,
      precioEstimado: v.precioEstimado === null || v.precioEstimado === undefined ? null : Number(v.precioEstimado),
      distancia: Math.round((Number((v as any).$extras?.distancia || 0)) * 100) / 100,
      tiempoEstimado: v.tiempoEstimadoMinutos === null || v.tiempoEstimadoMinutos === undefined ? null : Number(v.tiempoEstimadoMinutos),
      carga: v.carga,
      descripcion: v.carga,
      createdAt: v.createdAt.toISO(),
      // Una reserva activada llega aquí (buscando_conductor); sin esto el
      // conductor no ve el chip "Reserva" en su lista de solicitudes.
      tipoProgramacion: v.tipoProgramacion ?? 'inmediata',
      fechaProgramada: v.fechaProgramada,
      horaProgramada: v.horaProgramada,
      cliente: {
        id: String(v.cliente.id),
        _id: String(v.cliente.id),
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
      distancia: Math.round((Number((c as any).$extras?.distancia || 0)) * 100) / 100,
    }))
  }
}
