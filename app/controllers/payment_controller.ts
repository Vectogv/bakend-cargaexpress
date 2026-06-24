import ConfiguracionPlataforma from '#models/configuracion_plataforma'
import type { HttpContext } from '@adonisjs/core/http'
import RedisService from '#services/redis_service'
import app from '@adonisjs/core/services/app'
import { randomUUID } from 'node:crypto'
import { DateTime } from 'luxon'
import { emitToAdmin } from '#start/socket'

export default class PaymentController {
  async info({ auth, serialize }: HttpContext) {
    const user = auth.getUserOrFail()
    const cachedConfig = await RedisService.cacheGet<any>('config:plataforma')
    let config = cachedConfig ? null : await ConfiguracionPlataforma.first()
    if (!config && cachedConfig) config = cachedConfig
    if (!config) {
      config = await ConfiguracionPlataforma.first()
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
      nequiNumero: config?.nequiNumero || null,
      nequiNombre: config?.nequiNombre || null,
    })
  }

  async uploadProof({ auth, request, response, serialize }: HttpContext) {
    const user = auth.getUserOrFail()
    if (user.estadoCuenta !== 'suspension_por_pago') {
      return response
        .status(422)
        .send(serialize.withoutWrapping({ error: 'No tienes una suspensión por pago activa' }))
    }

    const file = request.file('file', {
      size: '5mb',
      extnames: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'pdf'],
    })
    if (!file) {
      return serialize.withoutWrapping({ error: 'No file uploaded' })
    }

    const fileName = `comprobante-${user.id}-${randomUUID()}.${file.extname}`
    await file.move(app.makePath('storage', 'uploads'), { name: fileName })

    user.comprobantePago = `/storage/uploads/${fileName}`
    user.estadoCuenta = 'esperando_confirmacion'
    await user.save()

    const config = await ConfiguracionPlataforma.first()
    const nequiInfo = config ? { numero: config.nequiNumero, nombre: config.nequiNombre } : null

    emitToAdmin('admin:payment_proof', {
      userId: user.id,
      nombre: `${user.nombre} ${user.apellido}`,
      montoDeuda: user.montoDeuda,
      comprobante: user.comprobantePago,
      nequi: nequiInfo,
    })

    return serialize.withoutWrapping({
      comprobante: user.comprobantePago,
      estadoCuenta: user.estadoCuenta,
      message: 'Comprobante recibido. El administrador lo verificará en breve.',
    })
  }
}
