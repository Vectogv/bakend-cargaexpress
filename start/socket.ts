import { Server as SocketServer } from 'socket.io'
import type { Server as NodeServer } from 'node:http'
import logger from '@adonisjs/core/services/logger'
import { Secret } from '@adonisjs/core/helpers'
import User from '#models/user'

let io: SocketServer | null = null

export function getIO(): SocketServer {
  if (!io) {
    throw new Error('Socket.io not initialized')
  }
  return io
}

export function emitToClient(clienteId: number | string, event: string, data: unknown) {
  getIO().to(`client:${clienteId}`).emit(event, data)
}

export function emitToDriver(driverUserId: number | string, event: string, data: unknown) {
  getIO().to(`driver:${driverUserId}`).emit(event, data)
}

export function emitToAdmin(event: string, data: unknown) {
  getIO().to('admin').emit(event, data)
}

export function initSocket(nodeHttpServer: NodeServer | null) {
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
  })

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

    // Auto-join según el rol del usuario autenticado
    if (user.rol === 'conductor') {
      socket.join(`driver:${user.id}`)
    } else if (user.rol === 'cliente') {
      socket.join(`client:${user.id}`)
    } else if (user.rol === 'admin') {
      socket.join('admin')
    }

    socket.on('disconnect', () => {
      logger.info(`Socket disconnected: ${socket.id}`)
    })
  })

  logger.info('Socket.io initialized')
}
