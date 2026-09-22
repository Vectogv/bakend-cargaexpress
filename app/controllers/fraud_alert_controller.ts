import LogFraude from '#models/log_fraude'
import type { HttpContext } from '@adonisjs/core/http'

const MAX_TEXT = 500
const MAX_METADATA_BYTES = 4_000

const toCoord = (v: unknown, limit: number) => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) && Math.abs(n) <= limit ? n : null
}

/**
 * Alertas antifraude auto-reportadas por la app móvil (GPS falso, root, etc.).
 * Cualquier usuario autenticado reporta sobre sí mismo; se limita tamaño y frecuencia.
 */
export default class FraudAlertController {
  async store({ auth, request, response, serialize }: HttpContext) {
    const user = auth.getUserOrFail()
    const { type, severity, message, data, timestamp } = request.only(['type', 'severity', 'message', 'data', 'timestamp'])

    if (!type || typeof type !== 'string') {
      return response.status(422).send(await serialize.withoutWrapping({ error: 'El campo type es requerido' }))
    }

    const lat = toCoord(data?.lat ?? data?.latitude, 90)
    const lng = toCoord(data?.lng ?? data?.longitude, 180)

    let safeData: unknown = data && typeof data === 'object' ? data : {}
    if (JSON.stringify(safeData).length > MAX_METADATA_BYTES) safeData = { truncated: true }

    try {
      await LogFraude.create({
        userId: user.id,
        tipo: type.slice(0, 64),
        descripcion: typeof message === 'string' ? message.slice(0, MAX_TEXT) : null,
        latitud: lat,
        longitud: lng,
        metadata: {
          severity: typeof severity === 'string' ? severity.slice(0, 32) : null,
          data: safeData,
          timestamp: typeof timestamp === 'string' || typeof timestamp === 'number' ? timestamp : null,
        },
      })
    } catch {
      // No quebrar el flujo del cliente por un fallo de logging
      return response.status(201).send(await serialize.withoutWrapping({ success: true, id: null }))
    }

    return response.status(201).send(await serialize.withoutWrapping({ success: true }))
  }
}
