import ConfiguracionPlataforma from '#models/configuracion_plataforma'
import type { HttpContext } from '@adonisjs/core/http'
import RedisService from '#services/redis_service'
import StorageService from '#services/storage_service'
import { randomUUID } from 'node:crypto'
import { DateTime } from 'luxon'
import { emitToAdmin } from '#start/socket'
import SignedUploadService from '#services/signed_upload_service'

export default class PaymentController {
  async info({ auth, serialize }: HttpContext) {
    const user = auth.getUserOrFail()
    const cachedConfig = await RedisService.cacheGet<any>('config:plataforma')
    let config = cachedConfig ? null : await ConfiguracionPlataforma.unica()
    if (!config && cachedConfig) config = cachedConfig
    if (!config) {
      config = await ConfiguracionPlataforma.unica()
      if (config) await RedisService.cacheSet('config:plataforma', config.toJSON(), 300)
    }
    const diasRestantes = user.deudaFechaLimite
      ? Math.ceil(user.deudaFechaLimite.diff(DateTime.now(), 'days').days)
      : null

    return serialize.withoutWrapping({
      montoDeuda: user.montoDeuda,
      deudaFechaLimite: user.deudaFechaLimite?.toISO() || null,
      diasRestantes: diasRestantes !== null && diasRestantes > 0 ? diasRestantes : 0,
      estadoCuenta: user.estadoCuenta,
      // Monto del comprobante en revisión (null si no hay uno).
      montoComprobante: user.montoComprobante ?? null,
      nequiNumero: config?.nequiNumero || null,
      nequiNombre: config?.nequiNombre || null,
    })
  }

  async uploadProof({ auth, request, response, serialize }: HttpContext) {
    const user = auth.getUserOrFail()
    // Paga cuando quiera: no hace falta esperar a que venza el plazo (estado
    // 'suspension_por_pago') para subir el comprobante. Solo se bloquea si no
    // hay deuda o si ya hay un comprobante en revisión.
    if (user.estadoCuenta === 'esperando_confirmacion') {
      return response
        .status(422)
        .send(await serialize.withoutWrapping({ error: 'Ya tienes un comprobante en revisión' }))
    }
    const deuda = Number(user.montoDeuda) || 0
    if (deuda <= 0) {
      return response
        .status(422)
        .send(await serialize.withoutWrapping({ error: 'No tienes una deuda pendiente por pagar' }))
    }

    const file = request.file('file', {
      size: '5mb',
      extnames: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'pdf'],
    })
    if (!file) {
      return response.status(400).send({ error: 'No file uploaded' })
    }

    if (!file.isValid) {
      return response.status(422).send({ error: file.errors[0]?.message || 'Archivo inválido' })
    }
    const fileName = `comprobante-${user.id}-${randomUUID()}.${file.extname}`
    await file.move(StorageService.uploadsDir(), { name: fileName })

    // El comprobante cubre la deuda de este momento: lo que se sume mientras
    // está en revisión (viajes en curso que terminan) sigue pendiente.
    user.comprobantePago = `/storage/uploads/${fileName}`
    user.estadoCuenta = 'esperando_confirmacion'
    user.montoComprobante = Number(user.montoDeuda) || 0
    user.comprobanteSubidoAt = DateTime.now()
    await user.save()

    const config = await ConfiguracionPlataforma.unica()
    const nequiInfo = config ? { numero: config.nequiNumero, nombre: config.nequiNombre } : null

    emitToAdmin('admin:payment_proof', {
      userId: user.id,
      nombre: `${user.nombre} ${user.apellido}`,
      montoDeuda: user.montoDeuda,
      montoComprobante: user.montoComprobante,
      comprobante: SignedUploadService.sign(user.comprobantePago),
      nequi: nequiInfo,
    })

    return serialize.withoutWrapping({
      comprobante: SignedUploadService.sign(user.comprobantePago),
      estadoCuenta: user.estadoCuenta,
      montoComprobante: user.montoComprobante,
      message: 'Comprobante recibido. El administrador lo verificará en breve.',
    })
  }
}
