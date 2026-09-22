import Conversacion from '#models/conversacion'
import MensajeConversacion from '#models/mensaje_conversacion'
import User from '#models/user'
import type { HttpContext } from '@adonisjs/core/http'
import db from '@adonisjs/lucid/services/db'
import { emitToModerators, getIO } from '#start/socket'
import { sendToToken } from '#services/push_notification_service'

export default class ConversacionController {
  private isAdmin(user: User) {
    return user.rol === 'admin'
  }

  private async listarConversaciones({ user, filtroCiudad }: { user: User; filtroCiudad: string | null }) {
    const query = Conversacion.query()
      .preload('usuario', (q) =>
        q.select('id', 'nombre', 'apellido', 'telefono', 'email', 'avatar', 'rol')
      )
      .preload('moderador', (q) => q.select('id', 'nombre', 'apellido'))
      .preload('viaje', (q) =>
        q.select('id', 'estado', 'origen_direccion', 'destino_direccion', 'cliente_id', 'conductor_id')
      )
      .orderBy('updated_at', 'desc')

    if (user.esModerador) {
      if (filtroCiudad) query.where('ciudad', filtroCiudad)
    } else if (!this.isAdmin(user)) {
      query.where('usuario_id', user.id)
    }

    const conversaciones = await query

    const ids = conversaciones.map((c) => c.id)

    const ultimos = await MensajeConversacion.query()
      .whereIn('conversacion_id', ids)
      .orderBy('created_at', 'desc')

    const ultimoPorId = new Map<number, MensajeConversacion>()
    for (const m of ultimos) {
      if (!ultimoPorId.has(m.conversacionId)) ultimoPorId.set(m.conversacionId, m)
    }

    const filtroNoLeido = MensajeConversacion.query()
      .whereIn('conversacion_id', ids)
      .where('leido', false)
      .whereNot('remitente_id', user.id)
      .select('conversacion_id')
      .count('* as total')
      .groupBy('conversacion_id')
    if (this.isAdmin(user)) {
      // admin ve todo global, sin filtro de pertenencia
    } else if (user.esModerador) {
      filtroNoLeido.whereIn('conversacion_id', [
        ...conversaciones.filter((c) => c.moderadorId === user.id).map((c) => c.id),
      ])
    } else {
      filtroNoLeido.whereIn('conversacion_id', [
        ...conversaciones.filter((c) => c.usuarioId === user.id).map((c) => c.id),
      ])
    }
    const noLeidos = await filtroNoLeido

    const noLeidoMap = new Map<number, number>()
    for (const nl of noLeidos) {
      noLeidoMap.set(Number(nl.conversacionId), Number(nl.$extras?.total || 0))
    }

    return conversaciones.map((c) => {
      const ultimo = ultimoPorId.get(c.id)
      return {
        id: c.id,
        usuario: c.usuario
          ? {
              id: c.usuario.id,
              nombre: `${c.usuario.nombre || ''} ${c.usuario.apellido || ''}`.trim(),
              telefono: c.usuario.telefono,
              email: c.usuario.email,
              avatar: c.usuario.avatar,
              rol: c.usuario.rol,
            }
          : null,
        moderador: c.moderador
          ? `${c.moderador.nombre || ''} ${c.moderador.apellido || ''}`.trim()
          : null,
        viaje: c.viaje
          ? {
              id: c.viaje.id,
              estado: c.viaje.estado,
              origenDireccion: c.viaje.origenDireccion,
              destinoDireccion: c.viaje.destinoDireccion,
            }
          : null,
        ciudad: c.ciudad,
        noLeidos: noLeidoMap.get(c.id) || 0,
        ultimoMensaje: ultimo?.mensaje ?? null,
        ultimoMensajeAt: ultimo?.createdAt?.toISO() ?? null,
        updatedAt: c.updatedAt.toISO(),
        createdAt: c.createdAt.toISO(),
      }
    })
  }

  async index({ auth, request, serialize, response }: HttpContext) {
    const user = auth.getUserOrFail()
    const usuarioId = request.input('usuarioId')
    const ciudad = request.input('ciudad')

    // Admin puede elegir ciudad; un moderador solo ve la suya (nunca todas).
    let filtroCiudad: string | null = null
    if (this.isAdmin(user)) {
      filtroCiudad = ciudad || null
    } else if (user.esModerador) {
      if (!user.zonaModerador) return serialize.withoutWrapping([])
      filtroCiudad = user.zonaModerador
    }

    const lista = await this.listarConversaciones({ user, filtroCiudad })

    if (usuarioId) {
      const conv = lista.find((c) => c.usuario?.id === Number(usuarioId))
      if (conv) return serialize.withoutWrapping(conv)
      return response.status(404).send(await serialize.withoutWrapping({ error: 'Conversación no encontrada' }))
    }

    return serialize.withoutWrapping(lista)
  }

  async store({ auth, request, response, serialize }: HttpContext) {
    const user = auth.getUserOrFail()
    if (!user.esModerador && !this.isAdmin(user)) {
      return response.status(403).send(await serialize.withoutWrapping({ error: 'Solo moderadores o administradores pueden abrir una conversación' }))
    }

    const usuarioId = Number(request.input('usuarioId'))
    const viajeId = request.input('viajeId') ? Number(request.input('viajeId')) : null
    const ciudad = request.input('ciudad') || user.zonaModerador || null

    if (!usuarioId) {
      return response.status(422).send(await serialize.withoutWrapping({ error: 'usuarioId es requerido' }))
    }
    if (usuarioId === user.id) {
      return response.status(422).send(await serialize.withoutWrapping({ error: 'No puedes conversar contigo mismo' }))
    }

    const destinatario = await User.find(usuarioId)
    if (!destinatario) {
      return response.status(404).send(await serialize.withoutWrapping({ error: 'Usuario no encontrado' }))
    }
    const rol = destinatario.rol
    if (!['cliente', 'conductor', 'admin'].includes(rol ?? '') && !destinatario.esModerador) {
      return response.status(422).send(await serialize.withoutWrapping({ error: 'Solo se puede contactar a clientes, conductores, moderadores o administradores' }))
    }

    let conversacion = await Conversacion.query()
      .where('moderador_id', user.id)
      .where('usuario_id', usuarioId)
      .if(Boolean(viajeId), (q) => q.where('viaje_id', viajeId as number))
      .first()

    if (!conversacion) {
      conversacion = await Conversacion.create({
        moderadorId: user.id,
        usuarioId,
        viajeId,
        ciudad,
      })
    }

    await conversacion.load('usuario', (q) => q.select('id', 'nombre', 'apellido', 'telefono', 'email', 'avatar', 'rol'))
    await conversacion.load('viaje', (q) => q.select('id', 'estado', 'origen_direccion', 'destino_direccion'))

    return serialize.withoutWrapping({
      id: conversacion.id,
      usuario: {
        id: conversacion.usuario.id,
        nombre: `${conversacion.usuario.nombre || ''} ${conversacion.usuario.apellido || ''}`.trim(),
        telefono: conversacion.usuario.telefono,
        email: conversacion.usuario.email,
        avatar: conversacion.usuario.avatar,
        rol: conversacion.usuario.rol,
      },
      viaje: conversacion.viaje
        ? {
            id: conversacion.viaje.id,
            estado: conversacion.viaje.estado,
            origenDireccion: conversacion.viaje.origenDireccion,
            destinoDireccion: conversacion.viaje.destinoDireccion,
          }
        : null,
      ciudad: conversacion.ciudad,
      createdAt: conversacion.createdAt.toISO(),
    })
  }

  async messages({ auth, params, response, serialize }: HttpContext) {
    const user = auth.getUserOrFail()
    const conversacion = await Conversacion.find(params.id)
    if (!conversacion) {
      return response.status(404).send(await serialize.withoutWrapping({ error: 'Conversación no encontrada' }))
    }

    const esModerador = conversacion.moderadorId === user.id
    const esUsuario = conversacion.usuarioId === user.id
    const esAdmin = this.isAdmin(user)
    if (!esModerador && !esUsuario && !esAdmin) {
      return response.status(403).send(await serialize.withoutWrapping({ error: 'No participas en esta conversación' }))
    }

    await MensajeConversacion.query()
      .where('conversacion_id', conversacion.id)
      .where('remitente_id', '!=', user.id)
      .where('leido', false)
      .update({ leido: true })

    const mensajes = await MensajeConversacion.query()
      .where('conversacion_id', conversacion.id)
      .preload('remitente', (q) => q.select('id', 'nombre', 'apellido', 'rol', 'es_moderador'))
      .orderBy('created_at', 'asc')

    return serialize.withoutWrapping(
      mensajes.map((m) => ({
        id: m.id,
        conversacionId: m.conversacionId,
        remitente: {
          id: m.remitente.id,
          nombre: `${m.remitente.nombre || ''} ${m.remitente.apellido || ''}`.trim(),
          rol: m.remitente.rol,
          esModerador: m.remitente.esModerador,
        },
        mensaje: m.mensaje,
        leido: m.leido,
        createdAt: m.createdAt.toISO(),
      }))
    )
  }

  async storeMessage({ auth, params, request, response, serialize }: HttpContext) {
    const user = auth.getUserOrFail()
    const conversacion = await Conversacion.find(params.id)
    if (!conversacion) {
      return response.status(404).send(await serialize.withoutWrapping({ error: 'Conversación no encontrada' }))
    }
    const esAdmin = this.isAdmin(user)
    if (conversacion.moderadorId !== user.id && conversacion.usuarioId !== user.id && !esAdmin) {
      return response.status(403).send(await serialize.withoutWrapping({ error: 'No participas en esta conversación' }))
    }

    const texto = request.input('mensaje')
    if (!texto || typeof texto !== 'string' || texto.trim().length === 0) {
      return response.status(422).send(await serialize.withoutWrapping({ error: 'El mensaje no puede estar vacío' }))
    }

    const msg = await MensajeConversacion.create({
      conversacionId: conversacion.id,
      remitenteId: user.id,
      mensaje: texto.trim(),
    })

    await msg.load('remitente', (q) => q.select('id', 'nombre', 'apellido', 'rol', 'es_moderador'))

    const payload = {
      id: msg.id,
      conversacionId: msg.conversacionId,
      remitente: {
        id: msg.remitente.id,
        nombre: `${msg.remitente.nombre || ''} ${msg.remitente.apellido || ''}`.trim(),
        rol: msg.remitente.rol,
        esModerador: msg.remitente.esModerador,
      },
      mensaje: msg.mensaje,
      leido: msg.leido,
      createdAt: msg.createdAt.toISO(),
    }

    const otroId = user.id === conversacion.moderadorId ? conversacion.usuarioId : user.id === conversacion.usuarioId ? conversacion.moderadorId : null
    const otros: User[] = []
    if (otroId) {
      const otro = await User.find(otroId)
      if (otro) otros.push(otro)
    }
    if (esAdmin && otros.length === 0) {
      const participantes = await User.query()
        .whereIn('id', [conversacion.moderadorId, conversacion.usuarioId])
        .select('id', 'rol', 'es_moderador', 'zona_moderador', 'fcm_token')
      otros.push(...participantes)
    }

    if (conversacion.ciudad) {
      emitToModerators(conversacion.ciudad, 'conversation:message', payload)
    } else {
      try { getIO().to('admin').emit('conversation:message', payload) } catch { /* socket no disponible */ }
    }

    for (const o of otros) {
      const esAdminDest = o.rol === 'admin'
      const esModDest = o.esModerador || o.rol === 'moderador'
      const esConductorDest = o.rol === 'conductor'
      let room: string
      if (esAdminDest) room = 'admin'
      else if (esModDest) room = `moderator:${o.zonaModerador || conversacion.ciudad || ''}`
      else if (esConductorDest) room = `driver:${o.id}`
      else room = `client:${o.id}`
      try { getIO().to(room).emit('conversation:message', payload) } catch { /* socket no disponible */ }

      if (o.fcmToken) {
        try {
          await sendToToken(o.fcmToken, `Soporte · ${payload.remitente.nombre}`, payload.mensaje)
        } catch { /* push no crítico */ }
      }
    }

    return serialize.withoutWrapping(payload)
  }

  async unreadCount({ auth, serialize }: HttpContext) {
    const user = auth.getUserOrFail()
    const esAdmin = this.isAdmin(user)
    const conversaciones = await Conversacion.query()
      .if(!esAdmin && user.esModerador, (q) => q.where('moderador_id', user.id))
      .if(!esAdmin && !user.esModerador, (q) => q.where('usuario_id', user.id))

    const ids = conversaciones.map((c) => c.id)
    if (ids.length === 0) {
      return serialize.withoutWrapping({ total: 0 })
    }

    const total = await MensajeConversacion.query()
      .whereIn('conversacion_id', ids)
      .where('leido', false)
      .whereNot('remitente_id', user.id)
      .count('* as total')
      .first()

    return serialize.withoutWrapping({ total: Number(total?.$extras?.total || 0) })
  }

  async contactableUsers({ auth, request, serialize }: HttpContext) {
    const user = auth.getUserOrFail()
    const q = (request.input('q') || '').toString().trim()
    const limit = Math.min(Number(request.input('limit') || 50), 100)

    // Admin: cualquier usuario. Moderador: staff + conductores de su ciudad; los
    // clientes solo aparecen al buscar (≥3 caracteres), nunca en un listado masivo.
    const esAdmin = this.isAdmin(user)
    const zona = user.zonaModerador
    const buscaClientes = q.length >= 3

    const query = User.query()
      .select('id', 'email', 'nombre', 'apellido', 'telefono', 'avatar', 'rol', 'es_moderador', 'zona_moderador')
      .where((w) => {
        if (esAdmin) {
          w.where('rol', 'cliente').orWhere('rol', 'conductor').orWhere('rol', 'admin').orWhere('es_moderador', true)
          return
        }
        w.where('rol', 'admin').orWhere('es_moderador', true)
        if (zona) {
          w.orWhereIn('id', db.from('conductores').where('ciudad', zona).select('usuario_id'))
        }
        if (buscaClientes) w.orWhere('rol', 'cliente')
      })
      .whereNot('id', user.id)
      .orderBy('nombre', 'asc')
      .limit(limit)

    if (q) {
      const term = `%${q}%`
      query.where((w) => {
        w.whereILike('nombre', term)
          .orWhereILike('apellido', term)
          .orWhereILike('email', term)
          .orWhereILike('telefono', term)
      })
    }

    const usuarios = await query

    return serialize.withoutWrapping(
      usuarios.map((u) => ({
        id: u.id,
        nombre: `${u.nombre || ''} ${u.apellido || ''}`.trim(),
        email: u.email,
        telefono: u.telefono,
        avatar: u.avatar,
        rol: u.rol,
        esModerador: u.esModerador,
        zonaModerador: u.esModerador ? u.zonaModerador : null,
        etiqueta: u.esModerador ? 'MODERADOR' : u.rol === 'admin' ? 'ADMIN' : u.rol === 'conductor' ? 'CONDUCTOR' : 'CLIENTE',
      }))
    )
  }
}