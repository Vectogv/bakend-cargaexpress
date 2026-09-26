import type { HttpContext } from '@adonisjs/core/http'
import { DateTime } from 'luxon'
import Conductor from '#models/conductor'
import TicketMensaje from '#models/ticket_mensaje'
import TicketSoporte, { TICKET_CATEGORIAS, TICKET_ESTADOS } from '#models/ticket_soporte'
import User from '#models/user'
import Viaje from '#models/viaje'
import { claveDe } from '#services/coverage_service'
import SignedUploadService from '#services/signed_upload_service'
import {
  aplicarEstado,
  esStaff,
  guardarAdjunto,
  notificarEstado,
  notificarMensaje,
  notificarTicketNuevo,
  resolverZonaTicket,
  rolAutorDe,
  serializarMensaje,
  serializarTicket,
} from '#services/ticket_service'

const ASUNTO_MAX = 150
const DESCRIPCION_MAX = 2000
const MENSAJE_MAX = 2000

const texto = (v: unknown) => (typeof v === 'string' ? v.trim() : '')

/**
 * Tickets de soporte.
 *
 *  - Usuario (cliente/conductor): /api/support/tickets — crea, lista los suyos,
 *    ve el hilo, escribe y cierra.
 *  - Moderador: /api/moderator/tickets — bandeja de su zona, tomar, responder,
 *    cambiar estado.
 *  - Admin: /api/admin/tickets — todo lo anterior sobre cualquier zona, más
 *    asignar moderador.
 */
export default class TicketController {
  // ───────────────────────────── helpers ─────────────────────────────

  private consultaBase() {
    return TicketSoporte.query()
      .preload('usuario', (q) => q.select('id', 'nombre', 'apellido', 'email', 'rol', 'telefono', 'avatar'))
      .preload('moderador', (q) => q.select('id', 'nombre', 'apellido', 'email', 'zona_moderador'))
      .preload('viaje', (q) => q.select('id', 'estado', 'origen_direccion', 'destino_direccion'))
      .withCount('mensajes')
  }

  private async cargarTicket(id: unknown, conMensajes = false) {
    const ticketId = Number(id)
    if (!Number.isInteger(ticketId) || ticketId <= 0) return null
    const query = this.consultaBase().where('id', ticketId)
    if (conMensajes) {
      query.preload('mensajes', (q) =>
        q.preload('autor', (a) => a.select('id', 'nombre', 'apellido', 'email', 'avatar')).orderBy('created_at', 'asc')
      )
    }
    return query.first()
  }

  /** Un moderador solo entra a tickets de su zona; el admin a todos. */
  private staffPuedeVer(user: User, ticket: TicketSoporte) {
    if (user.rol === 'admin') return true
    if (!ticket.zona) return false
    return claveDe(ticket.zona) === claveDe(user.zonaModerador || '')
  }

  private paginacion(request: HttpContext['request']) {
    const page = Math.max(1, Number.parseInt(request.input('page', '1')) || 1)
    const limit = Math.min(100, Math.max(1, Number.parseInt(request.input('limit', '20')) || 20))
    return { page, limit }
  }

  private filtroEstado(request: HttpContext['request']): string[] | { error: string } | null {
    const raw = texto(request.input('estado'))
    if (!raw) return null
    const estados = raw.split(',').map((e) => e.trim()).filter(Boolean)
    const invalido = estados.find((e) => !(TICKET_ESTADOS as readonly string[]).includes(e))
    if (invalido) return { error: `estado inválido: ${invalido}` }
    return estados
  }

  private async respuestaLista(
    query: ReturnType<TicketController['consultaBase']>,
    request: HttpContext['request'],
    serialize: HttpContext['serialize'],
    paraUsuario: boolean
  ) {
    const { page, limit } = this.paginacion(request)
    const resultado = await query.orderBy('updated_at', 'desc').orderBy('id', 'desc').paginate(page, limit)
    return serialize.withoutWrapping({
      tickets: resultado.all().map((t) => serializarTicket(t, { paraUsuario })),
      meta: { total: resultado.total, page: resultado.currentPage, perPage: resultado.perPage, lastPage: resultado.lastPage },
    })
  }

  private async crearMensaje(ticket: TicketSoporte, autor: User, request: HttpContext['request']) {
    const mensaje = texto(request.input('mensaje'))
    if (!mensaje) return { status: 422, error: 'mensaje es requerido' }
    if (mensaje.length > MENSAJE_MAX) return { status: 422, error: `mensaje supera ${MENSAJE_MAX} caracteres` }

    const adjunto = await guardarAdjunto(request)
    if ('error' in adjunto) return adjunto

    const creado = await TicketMensaje.create({
      ticketId: ticket.id,
      autorId: autor.id,
      rolAutor: rolAutorDe(autor),
      mensaje,
      adjunto: adjunto.adjunto,
    })
    await creado.load('autor', (a) => a.select('id', 'nombre', 'apellido', 'email', 'avatar'))
    return { mensaje: creado }
  }

  // ───────────────────────────── usuario ─────────────────────────────

  async upload({ request, response, serialize }: HttpContext) {
    if (!request.file('file')) {
      return response.status(400).send(await serialize.withoutWrapping({ error: 'No file uploaded' }))
    }
    const res = await guardarAdjunto(request)
    if ('error' in res) return response.status(res.status).send(await serialize.withoutWrapping({ error: res.error }))
    return serialize.withoutWrapping({ adjunto: res.adjunto, url: SignedUploadService.sign(res.adjunto) })
  }

  async store({ auth, request, response, serialize }: HttpContext) {
    const user = auth.getUserOrFail()
    if (user.rol !== 'cliente' && user.rol !== 'conductor') {
      return response
        .status(403)
        .send(await serialize.withoutWrapping({ error: 'Solo clientes y conductores pueden abrir tickets' }))
    }

    const categoria = texto(request.input('categoria'))
    const asunto = texto(request.input('asunto'))
    const descripcion = texto(request.input('descripcion'))
    const viajeIdRaw = request.input('viajeId')

    if (!(TICKET_CATEGORIAS as readonly string[]).includes(categoria)) {
      return response.status(422).send(
        await serialize.withoutWrapping({ error: `categoria inválida. Usa una de: ${TICKET_CATEGORIAS.join(', ')}` })
      )
    }
    if (asunto.length < 3 || asunto.length > ASUNTO_MAX) {
      return response
        .status(422)
        .send(await serialize.withoutWrapping({ error: `asunto debe tener entre 3 y ${ASUNTO_MAX} caracteres` }))
    }
    if (descripcion.length < 10 || descripcion.length > DESCRIPCION_MAX) {
      return response
        .status(422)
        .send(await serialize.withoutWrapping({ error: `descripcion debe tener entre 10 y ${DESCRIPCION_MAX} caracteres` }))
    }

    let viaje: Viaje | null = null
    if (viajeIdRaw !== undefined && viajeIdRaw !== null && viajeIdRaw !== '') {
      const viajeId = Number(viajeIdRaw)
      viaje = Number.isInteger(viajeId) ? await Viaje.find(viajeId) : null
      if (!viaje) {
        return response.status(404).send(await serialize.withoutWrapping({ error: 'Viaje no encontrado' }))
      }
      let participa = viaje.clienteId === user.id
      if (!participa && viaje.conductorId) {
        const conductor = await Conductor.find(viaje.conductorId)
        participa = conductor?.usuarioId === user.id
      }
      if (!participa) {
        return response.status(403).send(await serialize.withoutWrapping({ error: 'No participas en este viaje' }))
      }
    }

    const adjunto = await guardarAdjunto(request)
    if ('error' in adjunto) {
      return response.status(adjunto.status).send(await serialize.withoutWrapping({ error: adjunto.error }))
    }

    const zona = await resolverZonaTicket(user, viaje, request.input('zona'))

    const ticket = await TicketSoporte.create({
      usuarioId: user.id,
      viajeId: viaje?.id ?? null,
      categoria,
      asunto,
      descripcion,
      adjunto: adjunto.adjunto,
      estado: 'abierto',
      zona,
      ultimoMensajeAt: DateTime.now(),
    })

    const completo = (await this.cargarTicket(ticket.id, true))!
    notificarTicketNuevo(completo)

    return response.status(201).send(await serialize.withoutWrapping(serializarTicket(completo, { paraUsuario: true, conMensajes: true })))
  }

  async index({ auth, request, response, serialize }: HttpContext) {
    const user = auth.getUserOrFail()
    const estados = this.filtroEstado(request)
    if (estados && 'error' in estados) {
      return response.status(422).send(await serialize.withoutWrapping(estados))
    }
    const query = this.consultaBase()
      .where('usuario_id', user.id)
      .if(estados, (q) => q.whereIn('estado', estados as string[]))
    return this.respuestaLista(query, request, serialize, true)
  }

  async show({ auth, params, response, serialize }: HttpContext) {
    const user = auth.getUserOrFail()
    const ticket = await this.cargarTicket(params.id, true)
    if (!ticket || ticket.usuarioId !== user.id) {
      return response.status(404).send(await serialize.withoutWrapping({ error: 'Ticket no encontrado' }))
    }
    return serialize.withoutWrapping(serializarTicket(ticket, { paraUsuario: true, conMensajes: true }))
  }

  async storeMessage({ auth, params, request, response, serialize }: HttpContext) {
    const user = auth.getUserOrFail()
    const ticket = await this.cargarTicket(params.id)
    if (!ticket || ticket.usuarioId !== user.id) {
      return response.status(404).send(await serialize.withoutWrapping({ error: 'Ticket no encontrado' }))
    }
    if (ticket.estado === 'cerrado') {
      return response
        .status(422)
        .send(await serialize.withoutWrapping({ error: 'El ticket está cerrado. Abre uno nuevo si necesitas ayuda.' }))
    }

    const res = await this.crearMensaje(ticket, user, request)
    if ('error' in res) return response.status(res.status).send(await serialize.withoutWrapping({ error: res.error }))

    // Si estaba resuelto y el usuario vuelve a escribir, se reabre para el staff.
    if (ticket.estado === 'resuelto') aplicarEstado(ticket, 'en_proceso')
    ticket.ultimoMensajeAt = res.mensaje.createdAt
    await ticket.save()

    await notificarMensaje(ticket, res.mensaje, user)
    return response.status(201).send(
      await serialize.withoutWrapping({ ...serializarMensaje(res.mensaje), ticketEstado: ticket.estado })
    )
  }

  async close({ auth, params, response, serialize }: HttpContext) {
    const user = auth.getUserOrFail()
    const ticket = await this.cargarTicket(params.id)
    if (!ticket || ticket.usuarioId !== user.id) {
      return response.status(404).send(await serialize.withoutWrapping({ error: 'Ticket no encontrado' }))
    }
    if (ticket.estado === 'cerrado') {
      return response.status(422).send(await serialize.withoutWrapping({ error: 'El ticket ya está cerrado' }))
    }
    aplicarEstado(ticket, 'cerrado')
    await ticket.save()
    await notificarEstado(ticket, user)
    return serialize.withoutWrapping(serializarTicket(ticket, { paraUsuario: true }))
  }

  // ───────────────────────── moderador / admin ─────────────────────────

  /** Zona que aplica al staff: la del moderador; el admin puede filtrar con ?zona=. */
  private zonaStaff(user: User, request: HttpContext['request']): string | null {
    if (user.rol === 'admin') {
      const zona = texto(request.input('zona'))
      return zona ? claveDe(zona) : null
    }
    return claveDe(user.zonaModerador || '')
  }

  async staffIndex({ auth, request, response, serialize }: HttpContext) {
    const user = auth.getUserOrFail()
    const estados = this.filtroEstado(request)
    if (estados && 'error' in estados) {
      return response.status(422).send(await serialize.withoutWrapping(estados))
    }
    const zona = this.zonaStaff(user, request)
    const soloMios = ['1', 'true'].includes(String(request.input('mios', '')))
    const query = this.consultaBase()
      .if(zona, (q) => q.where('zona', zona!))
      .if(estados, (q) => q.whereIn('estado', estados as string[]))
      .if(soloMios, (q) => q.where('moderador_id', user.id))
    return this.respuestaLista(query, request, serialize, false)
  }

  async staffCount({ auth, request, serialize }: HttpContext) {
    const user = auth.getUserOrFail()
    const zona = this.zonaStaff(user, request)
    const filas = await TicketSoporte.query()
      .if(zona, (q) => q.where('zona', zona!))
      .whereIn('estado', ['abierto', 'en_proceso'])
      .select('estado')
      .count('* as total')
      .groupBy('estado')
    const conteo: Record<string, number> = { abiertos: 0, enProceso: 0 }
    for (const f of filas) {
      const n = Number(f.$extras.total || 0)
      if (f.estado === 'abierto') conteo.abiertos = n
      if (f.estado === 'en_proceso') conteo.enProceso = n
    }
    return serialize.withoutWrapping({ ...conteo, total: conteo.abiertos + conteo.enProceso })
  }

  async staffShow({ auth, params, response, serialize }: HttpContext) {
    const user = auth.getUserOrFail()
    const ticket = await this.cargarTicket(params.id, true)
    if (!ticket) {
      return response.status(404).send(await serialize.withoutWrapping({ error: 'Ticket no encontrado' }))
    }
    if (!this.staffPuedeVer(user, ticket)) {
      return response.status(403).send(await serialize.withoutWrapping({ error: 'Este ticket pertenece a otra zona' }))
    }
    return serialize.withoutWrapping(serializarTicket(ticket, { conMensajes: true }))
  }

  /** El moderador se asigna el ticket; si estaba abierto pasa a en_proceso. */
  async take({ auth, params, response, serialize }: HttpContext) {
    const user = auth.getUserOrFail()
    const ticket = await this.cargarTicket(params.id)
    if (!ticket) {
      return response.status(404).send(await serialize.withoutWrapping({ error: 'Ticket no encontrado' }))
    }
    if (!this.staffPuedeVer(user, ticket)) {
      return response.status(403).send(await serialize.withoutWrapping({ error: 'Este ticket pertenece a otra zona' }))
    }
    if (ticket.estado === 'cerrado') {
      return response.status(422).send(await serialize.withoutWrapping({ error: 'El ticket está cerrado' }))
    }
    if (ticket.moderadorId && ticket.moderadorId !== user.id && user.rol !== 'admin') {
      return response
        .status(409)
        .send(await serialize.withoutWrapping({ error: 'Otro moderador ya tiene este ticket' }))
    }

    ticket.moderadorId = user.id
    if (ticket.estado === 'abierto') aplicarEstado(ticket, 'en_proceso')
    await ticket.save()
    await ticket.load('moderador', (q) => q.select('id', 'nombre', 'apellido', 'email', 'zona_moderador'))
    await notificarEstado(ticket, user, { push: true })
    return serialize.withoutWrapping(serializarTicket(ticket))
  }

  async staffMessage({ auth, params, request, response, serialize }: HttpContext) {
    const user = auth.getUserOrFail()
    const ticket = await this.cargarTicket(params.id)
    if (!ticket) {
      return response.status(404).send(await serialize.withoutWrapping({ error: 'Ticket no encontrado' }))
    }
    if (!this.staffPuedeVer(user, ticket)) {
      return response.status(403).send(await serialize.withoutWrapping({ error: 'Este ticket pertenece a otra zona' }))
    }
    if (ticket.estado === 'cerrado') {
      return response
        .status(422)
        .send(await serialize.withoutWrapping({ error: 'El ticket está cerrado; reábrelo para responder' }))
    }

    const res = await this.crearMensaje(ticket, user, request)
    if ('error' in res) return response.status(res.status).send(await serialize.withoutWrapping({ error: res.error }))

    // Responder equivale a tomar el ticket si nadie lo tenía.
    if (!ticket.moderadorId && user.rol !== 'admin') ticket.moderadorId = user.id
    if (ticket.estado === 'abierto') aplicarEstado(ticket, 'en_proceso')
    ticket.ultimoMensajeAt = res.mensaje.createdAt
    await ticket.save()

    await notificarMensaje(ticket, res.mensaje, user)
    return response.status(201).send(
      await serialize.withoutWrapping({
        ...serializarMensaje(res.mensaje),
        ticketEstado: ticket.estado,
        moderadorId: ticket.moderadorId,
      })
    )
  }

  async updateStatus({ auth, params, request, response, serialize }: HttpContext) {
    const user = auth.getUserOrFail()
    const ticket = await this.cargarTicket(params.id)
    if (!ticket) {
      return response.status(404).send(await serialize.withoutWrapping({ error: 'Ticket no encontrado' }))
    }
    if (!this.staffPuedeVer(user, ticket)) {
      return response.status(403).send(await serialize.withoutWrapping({ error: 'Este ticket pertenece a otra zona' }))
    }
    const estado = texto(request.input('estado'))
    if (!(TICKET_ESTADOS as readonly string[]).includes(estado)) {
      return response
        .status(422)
        .send(await serialize.withoutWrapping({ error: `estado inválido. Usa uno de: ${TICKET_ESTADOS.join(', ')}` }))
    }
    if (estado === ticket.estado) {
      return serialize.withoutWrapping(serializarTicket(ticket))
    }

    aplicarEstado(ticket, estado)
    if (!ticket.moderadorId && user.rol !== 'admin') ticket.moderadorId = user.id
    await ticket.save()
    await ticket.load('moderador', (q) => q.select('id', 'nombre', 'apellido', 'email', 'zona_moderador'))
    await notificarEstado(ticket, user, { push: true })
    return serialize.withoutWrapping(serializarTicket(ticket))
  }

  /** Admin: asigna (o quita con null) el moderador del ticket. */
  async assign({ auth, params, request, response, serialize }: HttpContext) {
    const user = auth.getUserOrFail()
    const ticket = await this.cargarTicket(params.id)
    if (!ticket) {
      return response.status(404).send(await serialize.withoutWrapping({ error: 'Ticket no encontrado' }))
    }

    const raw = request.input('moderadorId')
    if (raw === null || raw === '' || raw === undefined) {
      ticket.moderadorId = null
    } else {
      const moderadorId = Number(raw)
      const moderador = Number.isInteger(moderadorId) ? await User.find(moderadorId) : null
      if (!moderador || !(moderador.esModerador || moderador.rol === 'admin')) {
        return response.status(422).send(await serialize.withoutWrapping({ error: 'moderadorId no es un moderador' }))
      }
      if (
        moderador.rol !== 'admin' &&
        ticket.zona &&
        moderador.zonaModerador &&
        claveDe(moderador.zonaModerador) !== claveDe(ticket.zona)
      ) {
        return response
          .status(422)
          .send(await serialize.withoutWrapping({ error: 'El moderador pertenece a otra zona' }))
      }
      ticket.moderadorId = moderador.id
      if (ticket.estado === 'abierto') aplicarEstado(ticket, 'en_proceso')
    }
    await ticket.save()
    await ticket.load('moderador', (q) => q.select('id', 'nombre', 'apellido', 'email', 'zona_moderador'))
    await notificarEstado(ticket, user)
    if (ticket.moderadorId) {
      const { getIO } = await import('#start/socket')
      try {
        getIO().to(`user:${ticket.moderadorId}`).emit('ticket:asignado', {
          id: ticket.id,
          asunto: ticket.asunto,
          categoria: ticket.categoria,
          estado: ticket.estado,
          zona: ticket.zona,
        })
      } catch {
        /* socket no disponible */
      }
    }
    return serialize.withoutWrapping(serializarTicket(ticket))
  }

  /** Staff que puede ser asignado (para el selector del panel). */
  async moderators({ auth, request, serialize }: HttpContext) {
    const user = auth.getUserOrFail()
    if (!esStaff(user)) return serialize.withoutWrapping({ moderadores: [] })
    const zona = this.zonaStaff(user, request)
    const lista = await User.query()
      .where('es_moderador', true)
      .select('id', 'nombre', 'apellido', 'email', 'zona_moderador')
      .orderBy('nombre', 'asc')
    return serialize.withoutWrapping({
      moderadores: lista
        .filter((m) => !zona || claveDe(m.zonaModerador || '') === zona)
        .map((m) => ({
          id: m.id,
          nombre: `${m.nombre || ''} ${m.apellido || ''}`.trim() || m.email,
          zona: m.zonaModerador ?? null,
        })),
    })
  }
}
