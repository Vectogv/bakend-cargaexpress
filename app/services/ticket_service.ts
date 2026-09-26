import { randomUUID } from 'node:crypto'
import type { HttpContext } from '@adonisjs/core/http'
import logger from '@adonisjs/core/services/logger'
import { DateTime } from 'luxon'
import Conductor from '#models/conductor'
import Notificacion from '#models/notificacion'
import TicketMensaje from '#models/ticket_mensaje'
import TicketSoporte from '#models/ticket_soporte'
import User from '#models/user'
import Viaje from '#models/viaje'
import { claveDe } from '#services/coverage_service'
import { resolverZonaViaje } from '#services/moderator_trip_events'
import { sendToToken } from '#services/push_notification_service'
import SignedUploadService from '#services/signed_upload_service'
import StorageService from '#services/storage_service'
import { emitToAdmin, emitToModerators, emitToUser, getIO } from '#start/socket'

/** Rol con el que un usuario escribe en un ticket. */
export function rolAutorDe(user: User): 'admin' | 'moderador' | 'usuario' {
  if (user.rol === 'admin') return 'admin'
  if (user.esModerador) return 'moderador'
  return 'usuario'
}

export const esStaff = (user: User) => rolAutorDe(user) !== 'usuario'

/**
 * Zona del ticket, en orden de preferencia: la del viaje (ciudad del conductor u
 * origen), la ciudad del conductor que lo abre, la del último viaje del cliente
 * o, como último recurso, la zona que sugiera la app. Null si no se pudo
 * determinar (solo el admin verá ese ticket).
 */
export async function resolverZonaTicket(
  user: User,
  viaje: Viaje | null,
  zonaSugerida?: unknown
): Promise<string | null> {
  if (viaje) {
    const zona = await resolverZonaViaje(viaje)
    if (zona) return zona
  }

  if (user.rol === 'conductor') {
    const conductor = await Conductor.findBy('usuario_id', user.id)
    const clave = conductor?.ciudad ? claveDe(conductor.ciudad) : ''
    if (clave) return clave
  } else {
    const ultimo = await Viaje.query().where('cliente_id', user.id).orderBy('created_at', 'desc').first()
    if (ultimo) {
      const zona = await resolverZonaViaje(ultimo)
      if (zona) return zona
    }
  }

  const sugerida = typeof zonaSugerida === 'string' ? claveDe(zonaSugerida) : ''
  return sugerida || null
}

/** Sala personal `user:{id}`: la comparten todos los roles (ver start/socket.ts). */
function emitToUserRoom(userId: number, event: string, data: unknown) {
  try {
    getIO().to(`user:${userId}`).emit(event, data)
  } catch {
    logger.warn(`Socket.io not available, skipping ${event} to user:${userId}`)
  }
}

export interface AdjuntoError {
  status: number
  error: string
}

/**
 * Adjunto de un ticket o mensaje. Acepta el archivo `file` (multipart, solo
 * imágenes) o, en JSON, `adjunto` con la ruta que devolvió
 * POST /api/support/tickets/upload. Devuelve la ruta sin firma para guardar.
 */
export async function guardarAdjunto(
  request: HttpContext['request']
): Promise<{ adjunto: string | null } | AdjuntoError> {
  const file = request.file('file', {
    size: '10mb',
    extnames: ['jpg', 'jpeg', 'png', 'webp', 'heic'],
  })
  if (file) {
    if (!file.isValid) {
      return { status: 422, error: 'Solo se permiten imágenes (jpg, png, webp, heic) de máx. 10MB' }
    }
    const fileName = `ticket-${randomUUID()}.${file.extname}`
    await file.move(StorageService.uploadsDir(), { name: fileName })
    return { adjunto: `/storage/uploads/${fileName}` }
  }

  const adjunto = request.input('adjunto')
  if (adjunto === undefined || adjunto === null || adjunto === '') return { adjunto: null }
  const [limpio] = SignedUploadService.clean([adjunto], 1)
  if (!limpio) {
    return { status: 422, error: 'adjunto inválido: usa la ruta devuelta por /api/support/tickets/upload' }
  }
  return { adjunto: limpio }
}

const nombreDe = (u?: User | null) => `${u?.nombre || ''} ${u?.apellido || ''}`.trim() || u?.email || ''

export function serializarMensaje(m: TicketMensaje) {
  return {
    id: m.id,
    ticketId: m.ticketId,
    autor: m.autor
      ? { id: m.autor.id, nombre: nombreDe(m.autor), avatar: m.autor.avatar ?? null }
      : { id: m.autorId, nombre: '', avatar: null },
    rolAutor: m.rolAutor,
    mensaje: m.mensaje,
    adjunto: SignedUploadService.sign(m.adjunto),
    createdAt: m.createdAt.toISO(),
  }
}

/**
 * JSON de un ticket. `paraUsuario` oculta los datos de contacto del staff (el
 * dueño solo ve el nombre de quien lo atiende).
 */
export function serializarTicket(t: TicketSoporte, opts: { paraUsuario?: boolean; conMensajes?: boolean } = {}) {
  const usuario = t.usuario
  const totalMensajes = t.$extras?.mensajes_count
  return {
    id: t.id,
    categoria: t.categoria,
    asunto: t.asunto,
    descripcion: t.descripcion,
    adjunto: SignedUploadService.sign(t.adjunto),
    estado: t.estado,
    zona: t.zona,
    viajeId: t.viajeId,
    viaje: t.viaje
      ? {
          id: t.viaje.id,
          estado: t.viaje.estado,
          origenDireccion: t.viaje.origenDireccion,
          destinoDireccion: t.viaje.destinoDireccion,
        }
      : null,
    usuario: usuario
      ? {
          id: usuario.id,
          nombre: nombreDe(usuario),
          rol: usuario.rol,
          avatar: usuario.avatar ?? null,
          ...(opts.paraUsuario ? {} : { email: usuario.email, telefono: usuario.telefono ?? null }),
        }
      : { id: t.usuarioId, nombre: '', rol: null, avatar: null },
    moderador: t.moderador
      ? {
          id: t.moderador.id,
          nombre: nombreDe(t.moderador),
          ...(opts.paraUsuario ? {} : { zona: t.moderador.zonaModerador ?? null }),
        }
      : null,
    totalMensajes: totalMensajes !== undefined ? Number(totalMensajes) : undefined,
    ultimoMensajeAt: t.ultimoMensajeAt?.toISO() ?? null,
    resueltoAt: t.resueltoAt?.toISO() ?? null,
    cerradoAt: t.cerradoAt?.toISO() ?? null,
    createdAt: t.createdAt.toISO(),
    updatedAt: t.updatedAt?.toISO() ?? null,
    ...(opts.conMensajes ? { mensajes: (t.mensajes || []).map(serializarMensaje) } : {}),
  }
}

/** Resumen que viaja por socket (sin hilo). */
function resumenTicket(t: TicketSoporte) {
  return {
    id: t.id,
    categoria: t.categoria,
    asunto: t.asunto,
    estado: t.estado,
    zona: t.zona,
    usuarioId: t.usuarioId,
    moderadorId: t.moderadorId,
    viajeId: t.viajeId,
    createdAt: t.createdAt.toISO(),
    updatedAt: t.updatedAt?.toISO() ?? null,
  }
}

/** Avisa al staff (moderadores de la zona y admin) de un ticket nuevo. */
export function notificarTicketNuevo(ticket: TicketSoporte) {
  const payload = {
    ...resumenTicket(ticket),
    usuario: ticket.usuario ? { id: ticket.usuario.id, nombre: nombreDe(ticket.usuario), rol: ticket.usuario.rol } : null,
  }
  if (ticket.zona) emitToModerators(ticket.zona, 'ticket:nuevo', payload)
  emitToAdmin('ticket:nuevo', payload)
}

/**
 * Avisa de un mensaje nuevo:
 *  - staff → usuario: socket `ticket:mensaje` + push FCM + notificación in-app.
 *  - usuario → staff: socket al moderador asignado (o a la zona si no hay) y al admin.
 */
export async function notificarMensaje(ticket: TicketSoporte, mensaje: TicketMensaje, autor: User) {
  const payload = {
    ticketId: ticket.id,
    estado: ticket.estado,
    zona: ticket.zona,
    usuarioId: ticket.usuarioId,
    moderadorId: ticket.moderadorId,
    mensaje: serializarMensaje(mensaje),
  }

  if (rolAutorDe(autor) === 'usuario') {
    if (ticket.moderadorId) emitToUserRoom(ticket.moderadorId, 'ticket:mensaje', payload)
    else if (ticket.zona) emitToModerators(ticket.zona, 'ticket:mensaje', payload)
    emitToAdmin('ticket:mensaje', payload)
    return
  }

  emitToUser(ticket.usuarioId, 'ticket:mensaje', payload)
  // El resto del staff también ve el hilo avanzar en el panel.
  if (ticket.zona) emitToModerators(ticket.zona, 'ticket:mensaje', payload)
  emitToAdmin('ticket:mensaje', payload)

  const titulo = `Respuesta a tu ticket #${ticket.id}`
  const cuerpo = mensaje.mensaje.length > 120 ? `${mensaje.mensaje.slice(0, 117)}…` : mensaje.mensaje
  try {
    await Notificacion.create({
      usuarioId: ticket.usuarioId,
      tipo: 'ticket_mensaje',
      titulo,
      mensaje: cuerpo,
      leido: false,
    })
  } catch (err) {
    logger.warn({ err, ticketId: ticket.id }, 'No se pudo guardar la notificación del ticket')
  }

  const destinatario = await User.find(ticket.usuarioId)
  if (destinatario?.fcmToken) {
    try {
      await sendToToken(destinatario.fcmToken, titulo, cuerpo, {
        tipo: 'ticket_mensaje',
        ticketId: String(ticket.id),
        mensajeId: String(mensaje.id),
        estado: ticket.estado,
      })
    } catch {
      /* push no crítico */
    }
  }
}

/** Avisa de un cambio de estado o asignación (usuario, moderador asignado, zona y admin). */
export async function notificarEstado(ticket: TicketSoporte, actor: User, opts: { push?: boolean } = {}) {
  const payload = {
    ...resumenTicket(ticket),
    moderador: ticket.moderador ? { id: ticket.moderador.id, nombre: nombreDe(ticket.moderador) } : null,
    actorId: actor.id,
  }
  emitToUser(ticket.usuarioId, 'ticket:estado', payload)
  if (ticket.moderadorId) emitToUserRoom(ticket.moderadorId, 'ticket:estado', payload)
  if (ticket.zona) emitToModerators(ticket.zona, 'ticket:estado', payload)
  emitToAdmin('ticket:estado', payload)

  if (!opts.push) return
  const etiquetas: Record<string, string> = {
    abierto: 'reabierto',
    en_proceso: 'tomado por soporte',
    resuelto: 'marcado como resuelto',
    cerrado: 'cerrado',
  }
  const titulo = `Ticket #${ticket.id} ${etiquetas[ticket.estado] || 'actualizado'}`
  const cuerpo = ticket.asunto
  try {
    await Notificacion.create({ usuarioId: ticket.usuarioId, tipo: 'ticket_estado', titulo, mensaje: cuerpo, leido: false })
  } catch (err) {
    logger.warn({ err, ticketId: ticket.id }, 'No se pudo guardar la notificación de estado del ticket')
  }
  const destinatario = await User.find(ticket.usuarioId)
  if (destinatario?.fcmToken) {
    try {
      await sendToToken(destinatario.fcmToken, titulo, cuerpo, {
        tipo: 'ticket_estado',
        ticketId: String(ticket.id),
        estado: ticket.estado,
      })
    } catch {
      /* push no crítico */
    }
  }
}

/** Aplica un cambio de estado con sus marcas de tiempo. */
export function aplicarEstado(ticket: TicketSoporte, estado: string) {
  ticket.estado = estado
  const ahora = DateTime.now()
  if (estado === 'resuelto') ticket.resueltoAt = ahora
  if (estado === 'cerrado') ticket.cerradoAt = ahora
  if (estado === 'abierto' || estado === 'en_proceso') {
    ticket.resueltoAt = null
    ticket.cerradoAt = null
  }
}
