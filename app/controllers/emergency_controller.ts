import AlertaEmergencia from '#models/alerta_emergencia'
import Viaje from '#models/viaje'
import Conductor from '#models/conductor'
import User from '#models/user'
import type { HttpContext } from '@adonisjs/core/http'
import { emitToAdmin, emitToClient, emitToDriver, emitToModerators, emitTripStatusChanged } from '#start/socket'
import { sendToMultiple } from '#services/push_notification_service'
import TripStateMachine from '#services/trip_state_machine'
import type { EstadoViaje } from '#services/trip_state_machine'
import { emitTripUpdateToModerators, resolverZonaAlerta } from '#services/moderator_trip_events'
import { getAlertaEstadoLabel } from '#services/emergency_status_labels'

export default class EmergencyController {
  async trigger({ auth, request, response, serialize }: HttpContext) {
    const user = auth.getUserOrFail()
    const { viajeId, lat, lng, motivo } = request.only(['viajeId', 'lat', 'lng', 'motivo'])

    // Solo participan del SOS el cliente del viaje o el conductor asignado.
    // Evita que un tercero pueda activar el pánico sobre un viaje ajeno.
    let viaje: Viaje | null = null
    if (viajeId) {
      viaje = await Viaje.find(Number(viajeId))
      if (!viaje) {
        return response.status(404).send({ error: 'Viaje no encontrado' })
      }
      const esCliente = viaje.clienteId === user.id
      let esConductor = false
      if (viaje.conductorId) {
        const cond = await Conductor.find(viaje.conductorId)
        esConductor = cond?.usuarioId === user.id
      }
      if (!esCliente && !esConductor) {
        return response.status(403).send({ error: 'No participas en este viaje' })
      }
    }

    const alerta = await AlertaEmergencia.create({
      userId: user.id,
      viajeId: viajeId ? Number(viajeId) : null,
      lat: lat ? Number(lat) : null,
      lng: lng ? Number(lng) : null,
      motivo: motivo || null,
    })

    // Si hay un viaje activo, cambiar su estado a 'sos'
    if (viaje) {
      if (TripStateMachine.validarTransicion(viaje.estado as EstadoViaje, 'sos')) {
        viaje.estado = 'sos'
        await viaje.save()

        let conductorUsuarioId: number | null = null
        if (viaje.conductorId) {
          const cond = await Conductor.find(viaje.conductorId)
          conductorUsuarioId = cond?.usuarioId ?? null
        }

        emitTripStatusChanged(viaje.clienteId, conductorUsuarioId, {
          id: String(viaje.id),
          estado: 'sos',
        })

        const sosPayload = {
          id: String(viaje.id),
          viajeId: String(viaje.id),
          alertaId: alerta.id,
          motivo: alerta.motivo,
        }
        emitToClient(viaje.clienteId, 'sos:activated', sosPayload)
        if (conductorUsuarioId) {
          emitToDriver(conductorUsuarioId, 'sos:activated', sosPayload)
        }

        emitTripUpdateToModerators(viaje, {
          alertaId: Number(alerta.id),
          motivo: alerta.motivo,
        })
      }
    }

    await alerta.load('usuario', (q) => q.select('id', 'nombre', 'apellido', 'telefono'))
    if (alerta.viajeId) {
      await alerta.load('viaje')
    }

    emitToAdmin('emergency:alert', {
      id: alerta.id,
      userId: alerta.userId,
      viajeId: alerta.viajeId,
      lat: alerta.lat,
      lng: alerta.lng,
      motivo: alerta.motivo,
      usuario: alerta.usuario
        ? {
            nombre: alerta.usuario.nombre,
            apellido: alerta.usuario.apellido,
            telefono: alerta.usuario.telefono,
          }
        : null,
      createdAt: alerta.createdAt.toISO(),
    })
    emitToAdmin('admin:emergency', {
      id: alerta.id,
      _id: String(alerta.id),
      userId: alerta.userId,
      viajeId: alerta.viajeId,
      lat: alerta.lat,
      lng: alerta.lng,
      motivo: alerta.motivo,
      usuario: alerta.usuario
        ? {
            nombre: alerta.usuario.nombre,
            apellido: alerta.usuario.apellido,
            telefono: alerta.usuario.telefono,
          }
        : null,
      createdAt: alerta.createdAt.toISO(),
    })

    const zona = await resolverZonaAlerta(
      alerta.viajeId,
      typeof alerta.lat === 'string' ? Number(alerta.lat) : alerta.lat,
      typeof alerta.lng === 'string' ? Number(alerta.lng) : alerta.lng
    )
    if (zona) {
      emitToModerators(zona, 'moderator:emergency:update', {
        id: alerta.id,
        estado: alerta.estado || 'pendiente',
        estadoLabel: getAlertaEstadoLabel(alerta.estado || 'pendiente'),
        viajeId: alerta.viajeId,
        lat: typeof alerta.lat === 'string' ? Number(alerta.lat) : alerta.lat,
        lng: typeof alerta.lng === 'string' ? Number(alerta.lng) : alerta.lng,
        motivo: alerta.motivo,
        createdAt: alerta.createdAt.toISO(),
      })
    }

    const admins = await User.query().where('rol', 'admin').whereNotNull('fcm_token')
    const adminTokens = admins.map((a) => a.fcmToken).filter(Boolean) as string[]
    if (adminTokens.length > 0) {
      await sendToMultiple(
        adminTokens,
        'ALERTA de emergencia',
        `Usuario ${user.nombre} ${user.apellido} activó el botón de pánico`
      )
    }

    response.status(201)
    return serialize.withoutWrapping({
      success: true,
      message: 'Alerta de emergencia registrada',
      id: alerta.id,
    })
  }
}
