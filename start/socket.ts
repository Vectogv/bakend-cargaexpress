import { Server as SocketServer } from 'socket.io'
import { createAdapter } from '@socket.io/redis-adapter'
import type { Server as NodeServer } from 'node:http'
import logger from '@adonisjs/core/services/logger'
import { Secret } from '@adonisjs/core/helpers'
import User from '#models/user'
import Viaje from '#models/viaje'
import Conductor from '#models/conductor'
import MensajeChat from '#models/mensaje_chat'
import RedisService from '#services/redis_service'

let io: SocketServer | null = null

export function getIO(): SocketServer {
  if (!io) {
    throw new Error('Socket.io not initialized')
  }
  return io
}

export function emitToClient(clienteId: number | string, event: string, data: unknown) {
  try {
    getIO().to(`client:${clienteId}`).emit(event, data)
  } catch {
    logger.warn(`Socket.io not available, skipping emitToClient event: ${event}`)
  }
}

export function emitToDriver(driverUserId: number | string, event: string, data: unknown) {
  try {
    getIO().to(`driver:${driverUserId}`).emit(event, data)
  } catch {
    logger.warn(`Socket.io not available, skipping emitToDriver event: ${event}`)
  }
}

export function emitToTrip(tripId: number | string, event: string, data: unknown) {
  try {
    getIO().to(`trip:${tripId}`).emit(event, data)
  } catch {
    logger.warn(`Socket.io not available, skipping emitToTrip event: ${event}`)
  }
}

/**
 * Emite `trip:status_changed` (y su alias `trip:status` que F usa en los
 * clientes antiguos) al cliente y, si hay conductor asignado, también a
 * `driver:{usuarioId}` para que ambos extremos mantengan sincronizada la app
 * durante todo el ciclo de vida del viaje.
 */
export function emitTripStatusChanged(
  clienteId: number | string,
  conductorUsuarioId: number | string | null | undefined,
  data: unknown
) {
  emitToClient(clienteId, 'trip:status', data)
  emitToClient(clienteId, 'trip:status_changed', data)
  if (conductorUsuarioId != null) {
    emitToDriver(conductorUsuarioId, 'trip:status', data)
    emitToDriver(conductorUsuarioId, 'trip:status_changed', data)
  }
}

/**
 * Emite un evento al usuario sin importar su rol (cliente o conductor).
 * Las notificaciones son por usuario, no por rol.
 */
export function emitToUser(userId: number | string, event: string, data: unknown) {
  emitToClient(userId, event, data)
  emitToDriver(userId, event, data)
}

export function emitToAdmin(event: string, data: unknown) {
  try {
    getIO().to('admin').emit(event, data)
  } catch {
    logger.warn(`Socket.io not available, skipping emitToAdmin event: ${event}`)
  }
}

export function emitToModerators(zona: string, event: string, data: unknown) {
  try {
    getIO().to(`moderator:${zona.trim().toLowerCase()}`).emit(event, data)
  } catch {
    logger.warn(`Socket.io not available, skipping emitToModerators event: ${event}`)
  }
}

export function emitToLeader(event: string, data: unknown) {
  try {
    getIO().to('leader').emit(event, data)
  } catch {
    logger.warn(`Socket.io not available, skipping emitToLeader event: ${event}`)
  }
}

export async function initSocket(nodeHttpServer: NodeServer | null) {
  if (!nodeHttpServer) {
    logger.warn('No Node HTTP server available for Socket.io')
    return
  }

  io = new SocketServer(nodeHttpServer, {
    cors: {
      origin: process.env.NODE_ENV === 'production'
        ? (process.env.CORS_ORIGIN || '').split(',').map((o) => o.trim()).filter(Boolean)
        : '*',
      methods: ['GET', 'POST'],
    },
    pingInterval: 25000,
    pingTimeout: 60000,
    transports: ['websocket', 'polling'],
  })

  // Redis adapter para multi-instancia
  try {
    const pubClient = RedisService.getClient()
    if (pubClient && RedisService.isConnected()) {
      const subClient = pubClient.duplicate()
      subClient.on('error', (err: Error) => logger.warn({ err }, 'Redis sub client error'))
      subClient.on('ready', () => logger.info('Redis sub client ready'))
      subClient.on('end', () => logger.warn('Redis sub client ended'))
      subClient.on('close', () => logger.warn('Redis sub client closed'))
      await subClient.connect().catch((connErr: Error) => {
        logger.warn({ connErr }, 'Redis subClient connect failed — running without adapter')
        return
      })
      try {
        io.adapter(createAdapter(pubClient, subClient))
        logger.info('Socket.IO Redis adapter enabled')
      } catch (adapterErr) {
        logger.warn({ adapterErr }, 'Redis adapter constructor failed — single instance mode')
        try {
          subClient.disconnect()
        } catch {
          // ignore
        }
      }
    } else {
      logger.warn('Socket.IO running without Redis adapter (single instance only)')
    }
  } catch (err) {
    logger.warn({ err }, 'Socket.IO Redis adapter failed — running in single-instance mode')
  }

  io.use(async (socket, next) => {
    // Preferir handshake.auth (no queda en logs de proxies); query se mantiene por compatibilidad con la app móvil.
    const tokenRaw = (socket.handshake.auth?.token || socket.handshake.query.token) as string | undefined
    if (!tokenRaw) {
      return next(new Error('Token de autenticación requerido'))
    }

    const tokenValue = tokenRaw.replace(/^Bearer\s*/i, '').trim()
    if (!tokenValue) {
      return next(new Error('Token de autenticación inválido'))
    }

    try {
      const token = await User.accessTokens.verify(new Secret(tokenValue))
      if (!token || token.isExpired()) {
        return next(new Error('Token de autenticación inválido o expirado'))
      }
      const user = await User.find(Number(token.tokenableId))
      if (!user) {
        return next(new Error('Usuario no encontrado'))
      }
      if (user.suspendido) {
        // `data.code` llega al cliente en connect_error para que deje de reconectar.
        return next(Object.assign(new Error('Cuenta suspendida'), { data: { code: 'CUENTA_SUSPENDIDA' } }))
      }
      ;(socket as any).user = user
      next()
    } catch (err) {
      logger.warn(`Socket auth failed: ${err}`)
      next(new Error('Error al autenticar'))
    }
  })

  io.on('connection', (socket) => {
    const user = (socket as any).user as User
    logger.info(`Socket connected: ${socket.id} (user: ${user.id}, rol: ${user.rol})`)

    // Track en Redis para estado distribuido
    RedisService.setSocketConnection(user.id, socket.id)

    // Room personal: permite cerrar todas las conexiones del usuario (ver SessionService)
    socket.join(`user:${user.id}`)

    // Unirse a rooms según rol
    if (user.esModerador && user.zonaModerador) {
      socket.join(`moderator:${user.zonaModerador.trim().toLowerCase()}`)
      logger.info(`Moderator ${user.id} joined room moderator:${user.zonaModerador}`)
    }
    if (user.esLider) {
      socket.join('leader')
    }
    if (user.rol === 'conductor') {
      socket.join(`driver:${user.id}`)
    } else if (user.rol === 'cliente') {
      socket.join(`client:${user.id}`)
    } else if (user.rol === 'admin') {
      socket.join('admin')
    }

    // ── Helpers de rooms de viaje y reenvío entre participantes ──────────
    // `tripId` puede llegar como número (join:trip) o dentro de un objeto
    // ({ tripId, ... }) desde F.
    const extraerTripId = (arg: unknown): number | null => {
      if (arg == null) return null
      if (typeof arg === 'number' || typeof arg === 'string') {
        const n = Number(arg)
        return Number.isFinite(n) ? n : null
      }
      const obj = arg as Record<string, unknown>
      const raw = obj.tripId ?? obj.id
      if (raw == null) return null
      const n = Number(raw)
      return Number.isFinite(n) ? n : null
    }

    const usuarioParticipa = async (viaje: Viaje): Promise<boolean> => {
      if (viaje.clienteId === user.id) return true
      if (!viaje.conductorId) return false
      const cond = await Conductor.find(viaje.conductorId)
      return cond?.usuarioId === user.id
    }

    const otroParticipante = async (
      viaje: Viaje
    ): Promise<{ destino: 'client' | 'driver'; target: number } | null> => {
      if (viaje.clienteId === user.id) {
        if (!viaje.conductorId) return null
        const cond = await Conductor.find(viaje.conductorId)
        if (!cond?.usuarioId) return null
        return { destino: 'driver', target: cond.usuarioId }
      }
      return { destino: 'client', target: viaje.clienteId }
    }

    const reenviarAOtroParticipante = async (event: string, data: unknown) => {
      try {
        const tripId = extraerTripId(data)
        if (tripId == null) return
        const viaje = await Viaje.find(tripId)
        if (!viaje) return
        if (!(await usuarioParticipa(viaje))) return
        const otro = await otroParticipante(viaje)
        if (!otro) return
        const payload = { ...(data as Record<string, unknown>), tripId: String(viaje.id) }
        if (otro.destino === 'driver') {
          emitToDriver(otro.target, event, payload)
        } else {
          emitToClient(otro.target, event, payload)
        }
      } catch (err) {
        logger.warn({ err }, `socket: ${event} relay failed`)
      }
    }

    // Handlers que F aún emite desde versiones antiguas: no hacen nada porque
    // los rooms los arma el propio cliente según su rol.
    socket.on('join:driver', () => {})
    socket.on('join:client', () => {})

    socket.on('join:trip', async (arg: unknown) => {
      try {
        const tripId = extraerTripId(arg)
        if (tripId == null) return
        const viaje = await Viaje.find(tripId)
        if (!viaje) return
        if (!(await usuarioParticipa(viaje))) return
        socket.join(`trip:${tripId}`)
      } catch (err) {
        logger.warn({ err }, 'socket: join:trip failed')
      }
    })

    socket.on('leave:trip', async (arg: unknown) => {
      try {
        const tripId = extraerTripId(arg)
        if (tripId == null) return
        socket.leave(`trip:${tripId}`)
      } catch (err) {
        logger.warn({ err }, 'socket: leave:trip failed')
      }
    })

    // Indicadores de escritura (reenvío entre cliente y conductor del viaje)
    socket.on('typing:start', (data: unknown) => void reenviarAOtroParticipante('typing:start', data))
    socket.on('typing:stop', (data: unknown) => void reenviarAOtroParticipante('typing:stop', data))

    // Marcar un mensaje como leído y notificar al otro participante
    socket.on('message:read', async (data: unknown) => {
      try {
        const tripId = extraerTripId(data)
        const messageId = (data as Record<string, unknown>)?.messageId
        if (tripId == null || messageId == null) return
        const viaje = await Viaje.find(tripId)
        if (!viaje) return
        if (!(await usuarioParticipa(viaje))) return
        await MensajeChat.query()
          .where('viaje_id', viaje.id)
          .where('id', Number(messageId))
          .where('remitente_id', '!=', user.id)
          .update({ leido: true })
        await reenviarAOtroParticipante('message:read', data)
      } catch (err) {
        logger.warn({ err }, 'socket: message:read failed')
      }
    })

    // Los mensajes se persisten vía REST (POST /trips/:id/chat, fuente de
    // verdad). Este handler solo valida participación para no abrir broadcast
    // no autorizados; no persiste nada para evitar duplicados.
    socket.on('message:send', async (data: unknown) => {
      try {
        const tripId = extraerTripId(data)
        if (tripId == null) return
        const viaje = await Viaje.find(tripId)
        if (!viaje) return
        await usuarioParticipa(viaje)
      } catch (err) {
        logger.warn({ err }, 'socket: message:send validation failed')
      }
    })

    // GPS del conductor (socket) → cliente del viaje activo y panel admin.
    socket.on('driver:location', async (data: unknown) => {
      try {
        const tripId = extraerTripId(data)
        if (tripId == null) return
        const viaje = await Viaje.find(tripId)
        if (!viaje || viaje.conductorId == null) return
        const conductor = await Conductor.find(viaje.conductorId)
        if (!conductor || conductor.usuarioId !== user.id) return
        const raw = data as Record<string, unknown>
        const lat = raw.latitude ?? raw.lat
        const lng = raw.longitude ?? raw.lng
        if (lat == null || lng == null) return
        emitToClient(viaje.clienteId, 'driver:location', { lat, lng })
      } catch (err) {
        logger.warn({ err }, 'socket: driver:location relay failed')
      }
    })

    // Retransmitir eventos de finalización entre cliente y conductor.
    // Se valida que el emisor participe en el viaje (item 15).
    socket.on('trip:finalize_request', async (data: unknown) => {
      try {
        const tripId = extraerTripId(data)
        if (tripId == null) return
        const viaje = await Viaje.find(tripId)
        if (!viaje) return
        if (!(await usuarioParticipa(viaje))) return
        emitToClient(viaje.clienteId, 'trip:finalize_request', data)
      } catch (err) {
        logger.warn({ err }, 'socket: trip:finalize_request forwarding failed')
      }
    })

    socket.on('trip:finalize_response', async (data: unknown) => {
      try {
        const tripId = extraerTripId(data)
        if (tripId == null) return
        const viaje = await Viaje.find(tripId)
        if (!viaje || !viaje.conductorId) return
        if (!(await usuarioParticipa(viaje))) return
        const conductor = await Conductor.find(viaje.conductorId)
        if (!conductor || !conductor.usuarioId) return
        emitToDriver(conductor.usuarioId, 'trip:finalize_response', data)
      } catch (err) {
        logger.warn({ err }, 'socket: trip:finalize_response forwarding failed')
      }
    })

    socket.on('trip:finalize_cancelled', async (data: unknown) => {
      try {
        const tripId = extraerTripId(data)
        if (tripId == null) return
        const viaje = await Viaje.find(tripId)
        if (!viaje || !viaje.clienteId) return
        const conductor = viaje.conductorId ? await Conductor.find(viaje.conductorId) : null
        if (!conductor || conductor.usuarioId !== user.id) return
        // Spread ordenado: la data original primero para que el receptor pueda
        // sobreescribir; el tripId oficial va después y siempre gana.
        emitToClient(viaje.clienteId, 'trip:finalize_cancelled', {
          ...(data as Record<string, unknown>),
          tripId: String(viaje.id),
        })
      } catch (err) {
        logger.warn({ err }, 'socket: trip:finalize_cancelled forwarding failed')
      }
    })

    socket.on('disconnect', () => {
      logger.info(`Socket disconnected: ${socket.id}`)
      RedisService.removeSocketConnection(user.id)
    })
  })

  logger.info('Socket.io initialized')
}
