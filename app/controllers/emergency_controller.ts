import AlertaEmergencia from '#models/alerta_emergencia'
import User from '#models/user'
import type { HttpContext } from '@adonisjs/core/http'
import { emitToAdmin } from '#start/socket'
import { sendToMultiple } from '#services/push_notification_service'

export default class EmergencyController {
  async trigger({ auth, request, response, serialize }: HttpContext) {
    const user = auth.getUserOrFail()
    const { viajeId, lat, lng } = request.only(['viajeId', 'lat', 'lng'])

    const alerta = await AlertaEmergencia.create({
      userId: user.id,
      viajeId: viajeId ? Number(viajeId) : null,
      lat: lat ? Number(lat) : null,
      lng: lng ? Number(lng) : null,
    })

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
