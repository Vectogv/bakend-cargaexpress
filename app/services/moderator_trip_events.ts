import Viaje from '#models/viaje'
import Conductor from '#models/conductor'
import ConfiguracionPlataforma from '#models/configuracion_plataforma'
import { emitToModerators } from '#start/socket'
import { getTripEstadoLabel } from './trip_status_labels.js'

const R = 6371

export function calcularDistanciaKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
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

export async function resolverZonaViaje(viaje: Viaje): Promise<string | null> {
  if (viaje.conductorId) {
    const conductor = await Conductor.find(viaje.conductorId)
    if (conductor?.ciudad) return conductor.ciudad.trim().toLowerCase()
  }

  if (viaje.origenLat !== null && viaje.origenLng !== null) {
    const config = await ConfiguracionPlataforma.first()
    const zonas = config?.zonasCobertura
    if (zonas && Array.isArray(zonas) && zonas.length > 0) {
      let mejor: { zona: string; dist: number } | null = null
      for (const z of zonas) {
        const dist = calcularDistanciaKm(
          Number(viaje.origenLat),
          Number(viaje.origenLng),
          Number(z.lat),
          Number(z.lng)
        )
        if ((!mejor || dist < mejor.dist) && dist <= Number(z.radio ?? 30)) {
          mejor = { zona: z.nombre || z.zona || '', dist }
        }
      }
      if (mejor?.zona) return mejor.zona.toLowerCase()
    }
  }

  return null
}

export async function resolverZonaAlerta(
  viajeId: number | null,
  lat: number | null,
  lng: number | null
): Promise<string | null> {
  if (viajeId) {
    const viaje = await Viaje.find(viajeId)
    if (viaje) return resolverZonaViaje(viaje)
  }

  if (lat !== null && lng !== null) {
    const config = await ConfiguracionPlataforma.first()
    const zonas = config?.zonasCobertura
    if (zonas && Array.isArray(zonas) && zonas.length > 0) {
      let mejor: { zona: string; dist: number } | null = null
      for (const z of zonas) {
        const dist = calcularDistanciaKm(
          Number(lat),
          Number(lng),
          Number(z.lat),
          Number(z.lng)
        )
        if ((!mejor || dist < mejor.dist) && dist <= Number(z.radio ?? 30)) {
          mejor = { zona: z.nombre || z.zona || '', dist }
        }
      }
      if (mejor?.zona) return mejor.zona.toLowerCase()
    }
  }

  return null
}

export async function emitTripUpdateToModerators(viaje: Viaje, detalles?: Record<string, unknown>) {
  try {
    const zona = await resolverZonaViaje(viaje)
    if (!zona) return

    await viaje.load('cliente', (q) => q.select('id', 'nombre', 'apellido', 'telefono'))
    await viaje.load('conductor', (q) =>
      q.select('id', 'usuario_id', 'placa', 'tipo_vehiculo', 'ciudad').preload('usuario', (uq) => uq.select('id', 'nombre', 'apellido', 'telefono'))
    )

    const payload = {
      id: String(viaje.id),
      estado: viaje.estado,
      estadoLabel: getTripEstadoLabel(viaje.estado),
      origenDireccion: viaje.origenDireccion,
      destinoDireccion: viaje.destinoDireccion,
      carga: viaje.carga,
      precioEstimado: Number(viaje.precioEstimado || 0),
      precioFinal: Number(viaje.precioFinal || 0),
      cliente: viaje.cliente
        ? {
            id: viaje.cliente.id,
            nombre: `${viaje.cliente.nombre || ''} ${viaje.cliente.apellido || ''}`.trim(),
            telefono: viaje.cliente.telefono,
          }
        : null,
      conductor: viaje.conductor
        ? {
            id: viaje.conductor.id,
            placa: viaje.conductor.placa,
            tipoVehiculo: viaje.conductor.tipoVehiculo,
            ciudad: viaje.conductor.ciudad,
            nombre: `${viaje.conductor.usuario?.nombre || ''} ${viaje.conductor.usuario?.apellido || ''}`.trim(),
            telefono: viaje.conductor.usuario?.telefono,
          }
        : null,
      timestamps: {
        createdAt: viaje.createdAt?.toISO() ?? null,
        actualizadoAt: new Date().toISOString(),
      },
      ...(detalles ?? {}),
    }

    emitToModerators(zona, 'moderator:trip:update', payload)
  } catch (error) {
    console.warn('emitTripUpdateToModerators failed', error)
  }
}