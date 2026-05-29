import { Server as SocketServer } from 'socket.io'
import type { Server as NodeServer } from 'node:http'
import logger from '@adonisjs/core/services/logger'

let io: SocketServer | null = null

export function getIO(): SocketServer {
  if (!io) {
    throw new Error('Socket.io not initialized')
  }
  return io
}

export function initSocket(nodeHttpServer: NodeServer | null) {
  if (!nodeHttpServer) {
    logger.warn('No Node HTTP server available for Socket.io')
    return
  }

  io = new SocketServer(nodeHttpServer, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
    },
  })

  io.on('connection', (socket) => {
    logger.info(`Socket connected: ${socket.id}`)

    socket.on('join:driver', (userId: string | number) => {
      socket.join(`driver:${userId}`)
    })

    socket.on('join:client', (userId: string | number) => {
      socket.join(`client:${userId}`)
    })

    socket.on('disconnect', () => {
      logger.info(`Socket disconnected: ${socket.id}`)
    })
  })

  logger.info('Socket.io initialized')
}
