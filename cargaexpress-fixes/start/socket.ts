import { Server as SocketServer } from 'socket.io'
import type { Server as NodeServer } from 'node:http'
import logger from '@adonisjs/core/services/logger'
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
      // En producción esto se controla por variable de entorno
      origin: process.env.NODE_ENV === 'production'
        ? (process.env.CORS_ORIGIN || '').split(',').map((o) => o.trim()).filter(Boolean)
        : '*',
      methods: ['GET', 'POST'],
    },
  })

  io.on('connection', (socket) => {
    logger.info(`Socket connected: ${socket.id}`)

    // ✅ CORREGIDO: join:driver verifica que el userId corresponda a un conductor real
    socket.on('join:driver', async (userId: string | number) => {
      try {
        const user = await User.find(userId)
        if (user && user.rol === 'conductor') {
          socket.join(`driver:${userId}`)
        }
      } catch (err) {
        logger.warn(`join:driver failed for userId=${userId}`)
      }
    })

    // ✅ CORREGIDO: join:client verifica que el userId exista
    socket.on('join:client', async (userId: string | number) => {
      try {
        const user = await User.find(userId)
        if (user && user.rol === 'cliente') {
          socket.join(`client:${userId}`)
        }
      } catch (err) {
        logger.warn(`join:client failed for userId=${userId}`)
      }
    })

    // ✅ CORREGIDO: join:admin verifica en BD que el usuario tenga rol admin
    socket.on('join:admin', async (userId: string | number) => {
      try {
        const user = await User.find(userId)
        if (user && user.rol === 'admin') {
          socket.join('admin')
        } else {
          logger.warn(`Unauthorized join:admin attempt for userId=${userId}`)
        }
      } catch (err) {
        logger.warn(`join:admin failed for userId=${userId}`)
      }
    })

    socket.on('disconnect', () => {
      logger.info(`Socket disconnected: ${socket.id}`)
    })
  })

  logger.info('Socket.io initialized')
}
