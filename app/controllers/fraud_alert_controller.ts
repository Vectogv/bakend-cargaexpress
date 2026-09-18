import LogFraude from '#models/log_fraude'
import type { HttpContext } from '@adonisjs/core/http'

export default class FraudAlertController {
  async store({ auth, request, response, serialize }: HttpContext) {
    const user = auth.getUserOrFail()
    const { type, severity, message, data, timestamp } = request.only(['type', 'severity', 'message', 'data', 'timestamp'])

    if (!type || typeof type !== 'string') {
      return response.status(422).send(serialize.withoutWrapping({ error: 'El campo type es requerido' }))
    }

    const lat = data?.lat ?? data?.latitude ?? null
    const lng = data?.lng ?? data?.longitude ?? null

    try {
      await LogFraude.create({
        userId: user.id,
        tipo: type,
        descripcion: message ?? null,
        latitud: lat != null ? Number(lat) : null,
        longitud: lng != null ? Number(lng) : null,
        metadata: { severity: severity ?? null, data: data ?? {}, timestamp: timestamp ?? null },
      })
    } catch (err) {
      // No quebrar el flujo del cliente por un fallo de logging
      return response.status(201).send(await serialize.withoutWrapping({ success: true, id: null }))
    }

    return response.status(201).send(await serialize.withoutWrapping({ success: true }))
  }
}