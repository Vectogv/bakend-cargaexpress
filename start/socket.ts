import { Server as SocketServer } from 'socket.io'
import { createAdapter } from '@socket.io/redis-adapter'
import type { Server as NodeServer } from 'node:http'
import logger from '@adonisjs/core/services/logger'
import { Secret } from '@adonisjs/core/helpers'
import User from '#models/user'
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

export function emitToAdmin(event: string, data: unknown) {
  try {
    getIO().to('admin').emit(event, data)
  } catch {
    logger.warn(`Socket.io not available, skipping emitToAdmin event: ${event}`)
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
        await subClient.disconnect().catch(() => {})
      }
    } else {
      logger.warn('Socket.IO running without Redis adapter (single instance only)')
    }
  } catch (err) {
    logger.warn({ err }, 'Socket.IO Redis adapter failed — running in single-instance mode')
  }

  io.use(async (socket, next) => {
    const tokenRaw = socket.handshake.query.token as string | undefined
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

    // Unirse a rooms según rol
    if (user.rol === 'conductor') {
      socket.join(`driver:${user.id}`)
    } else if (user.rol === 'cliente') {
      socket.join(`client:${user.id}`)
    } else if (user.rol === 'admin') {
      socket.join('admin')
    }

    socket.on('join:trip', (tripId: number | string) => {
      socket.join(`trip:${tripId}`)
    })

    socket.on('leave:trip', (tripId: number | string) => {
      socket.leave(`trip:${tripId}`)
    })

    // Retransmitir eventos de finalización entre cliente y conductor
    socket.on('trip:finalize_request', (data: unknown) => {
      if (data && typeof data === 'object' && 'tripId' in (data as Record<string, unknown>)) {
        const tripId = (data as Record<string, unknown>).tripId
        socket.broadcast.emit('trip:finalize_request', data)
      }
    })

    socket.on('trip:finalize_response', (data: unknown) => {
      if (data && typeof data === 'object' && 'tripId' in (data as Record<string, unknown>)) {
        socket.broadcast.emit('trip:finalize_response', data)
      }
    })

    socket.on('trip:finalize_cancelled', (data: unknown) => {
      if (data && typeof data === 'object' && 'tripId' in (data as Record<string, unknown>)) {
        socket.broadcast.emit('trip:finalize_cancelled', data)
      }
    })

    socket.on('disconnect', () => {
      logger.info(`Socket disconnected: ${socket.id}`)
      RedisService.removeSocketConnection(user.id)
    })
  })

  logger.info('Socket.io initialized')
}
