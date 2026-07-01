import AlertaEmergencia from '#models/alerta_emergencia'
import Viaje from '#models/viaje'
import Conductor from '#models/conductor'
import User from '#models/user'
import type { HttpContext } from '@adonisjs/core/http'
import { emitToAdmin, emitToClient, emitToDriver } from '#start/socket'
import { sendToMultiple } from '#services/push_notification_service'
import TripStateMachine from '#services/trip_state_machine'
import type { EstadoViaje } from '#services/trip_state_machine'

export default class EmergencyController {
  async trigger({ auth, request, response, serialize }: HttpContext) {
    const user = auth.getUserOrFail()
    const { viajeId, lat, lng, motivo } = request.only(['viajeId', 'lat', 'lng', 'motivo'])

    const alerta = await AlertaEmergencia.create({
      userId: user.id,
      viajeId: viajeId ? Number(viajeId) : null,
      lat: lat ? Number(lat) : null,
      lng: lng ? Number(lng) : null,
      motivo: motivo || null,
    })

    // Si hay un viaje activo, cambiar su estado a 'sos'
    if (alerta.viajeId) {
      const viaje = await Viaje.find(alerta.viajeId)
      if (viaje && TripStateMachine.validarTransicion(viaje.estado as EstadoViaje, 'sos')) {
        viaje.estado = 'sos'
        await viaje.save()

        emitToClient(viaje.clienteId, 'trip:status_changed', {
          id: String(viaje.id),
          estado: 'sos',
        })

        emitToClient(viaje.clienteId, 'sos:activated', {
          id: String(viaje.id),
          alertaId: alerta.id,
          motivo: alerta.motivo,
        })

        if (viaje.conductorId) {
          const conductor = await Conductor.find(viaje.conductorId)
          if (conductor) {
            emitToDriver(conductor.usuarioId, 'sos:activated', {
              viajeId: String(viaje.id),
              alertaId: alerta.id,
              motivo: alerta.motivo,
            })
          }
        }
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

    const admins = await User.query().where('rol', 'admin').whereNotNull('fcm_token')
    const adminTokens = admins.map((a) => a.fcmToken).filter(Boolean) as string[]
    if (adminTokens.length > 0) {
      await sendToMultiple(
        adminTokens,
        'ALERTA de emergencia',
        `Usuario ${user.nombre} ${user.apellido} activó el botón de pánico`
      )
    }

    return response.status(201).send(
      serialize.withoutWrapping({
        success: true,
        message: 'Alerta de emergencia registrada',
        id: alerta.id,
      })
    )
  }
}
