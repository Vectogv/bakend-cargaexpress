import User from '#models/user'
import Conductor from '#models/conductor'
import Comunicado from '#models/comunicado'
import Encuesta from '#models/encuesta'
import RespuestaEncuesta from '#models/respuesta_encuesta'
import ReporteModerador from '#models/reporte_moderador'
import Aviso from '#models/aviso'
import type { HttpContext } from '@adonisjs/core/http'
import { DateTime } from 'luxon'
import { sendToMultiple } from '#services/push_notification_service'
import { emitToAdmin, getIO } from '#start/socket'

export default class ModeratorController {
  async storeComunicado({ auth, request, response, serialize }: HttpContext) {
    const user = auth.getUserOrFail()
    const { titulo, contenido } = request.only(['titulo', 'contenido'])
    if (!titulo || !contenido) {
      return response
        .status(422)
        .send(serialize.withoutWrapping({ error: 'titulo y contenido son requeridos' }))
    }

    const comunicado = await Comunicado.create({
      moderadorId: user.id,
      zona: user.zonaModerador || '',
      titulo,
      contenido,
      estado: 'pendiente',
    })

    emitToAdmin('admin:new_comunicado', {
      comunicadoId: comunicado.id,
      moderador: `${user.nombre} ${user.apellido}`.trim(),
      zona: comunicado.zona,
      titulo: comunicado.titulo,
    })

    return serialize.withoutWrapping({
      id: comunicado.id,
      estado: comunicado.estado,
      titulo: comunicado.titulo,
      createdAt: comunicado.createdAt.toISO(),
    })
  }

  async myComunicados({ auth, request, serialize }: HttpContext) {
    const user = auth.getUserOrFail()
    const page = Number.parseInt(request.input('page', '1'))
    const limit = Number.parseInt(request.input('limit', '20'))
    const comunicados = await Comunicado.query()
      .where('moderador_id', user.id)
      .select('id', 'zona', 'titulo', 'contenido', 'estado', 'nota_rechazo', 'publicado_at', 'created_at')
      .orderBy('created_at', 'desc')
      .paginate(page, limit)

    return serialize.withoutWrapping(
      comunicados.all().map((c) => ({
        id: c.id,
        zona: c.zona,
        titulo: c.titulo,
        contenido: c.contenido,
        estado: c.estado,
        notaRechazo: c.notaRechazo,
        publicadoAt: c.publicadoAt?.toISO() || null,
        createdAt: c.createdAt.toISO(),
      }))
    )
  }

  async driversList({ request, serialize }: HttpContext) {
    const page = Number.parseInt(request.input('page', '1'))
    const limit = Number.parseInt(request.input('limit', '20'))
    const conductores = await Conductor.query()
      .select('id', 'usuario_id', 'placa', 'tipo_vehiculo', 'online', 'calificacion', 'total_viajes', 'created_at')
      .preload('usuario', (q) => q.select('id', 'nombre', 'apellido', 'telefono', 'email'))
      .orderBy('created_at', 'desc')
      .paginate(page, limit)

    return serialize.withoutWrapping(
      conductores.all().map((c) => ({
        id: c.id,
        usuarioId: c.usuarioId,
        placa: c.placa,
        tipoVehiculo: c.tipoVehiculo,
        online: c.online,
        calificacion: c.calificacion,
        totalViajes: c.totalViajes,
        usuario: c.usuario
          ? {
              nombre: `${c.usuario.nombre || ''} ${c.usuario.apellido || ''}`.trim(),
              telefono: c.usuario.telefono,
              email: c.usuario.email,
            }
          : null,
        createdAt: c.createdAt.toISO(),
      }))
    )
  }

  async inactiveDrivers({ request, serialize }: HttpContext) {
    const fechaLimite = DateTime.now().minus({ days: 7 }).toSQL()
    const page = Number.parseInt(request.input('page', '1'))
    const limit = Number.parseInt(request.input('limit', '20'))

    const conductores = await Conductor.query()
      .select('id', 'usuario_id', 'placa', 'tipo_vehiculo', 'total_viajes', 'ultima_ubicacion_lat', 'ultima_ubicacion_lng', 'created_at')
      .whereNotExists((qb) => {
        qb.from('viajes')
          .whereRaw('viajes.conductor_id = conductores.id')
          .where('viajes.created_at', '>=', fechaLimite)
      })
      .where('online', false)
      .preload('usuario', (q) => q.select('id', 'nombre', 'apellido', 'telefono', 'email'))
      .orderBy('created_at', 'desc')
      .paginate(page, limit)

    return serialize.withoutWrapping(
      conductores.all().map((c) => ({
        id: c.id,
        usuarioId: c.usuarioId,
        placa: c.placa,
        tipoVehiculo: c.tipoVehiculo,
        totalViajes: c.totalViajes,
        ultimaUbicacion: c.ultimaUbicacionLat
          ? { lat: c.ultimaUbicacionLat, lng: c.ultimaUbicacionLng }
          : null,
        usuario: c.usuario
          ? {
              nombre: `${c.usuario.nombre || ''} ${c.usuario.apellido || ''}`.trim(),
              telefono: c.usuario.telefono,
              email: c.usuario.email,
            }
          : null,
        createdAt: c.createdAt.toISO(),
      }))
    )
  }

  async notifyDriver({ params, response, serialize }: HttpContext) {
    const conductor = await Conductor.find(params.id)
    if (!conductor) {
      return response
        .status(404)
        .send(serialize.withoutWrapping({ error: 'Conductor no encontrado' }))
    }

    const usuario = await User.find(conductor.usuarioId)
    if (!usuario?.fcmToken) {
      return response
        .status(422)
        .send(serialize.withoutWrapping({ error: 'El conductor no tiene token FCM' }))
    }

    await sendToMultiple(
      [usuario.fcmToken],
      'Recordatorio CargaExpress',
      'Hemos notado que no has realizado viajes recientemente. ¡Los clientes te esperan!'
    )

    return serialize.withoutWrapping({ success: true, conductorId: conductor.id })
  }

  async reportDriver({ auth, params, request, response, serialize }: HttpContext) {
    const user = auth.getUserOrFail()
    const conductor = await Conductor.find(params.id)
    if (!conductor) {
      return response
        .status(404)
        .send(serialize.withoutWrapping({ error: 'Conductor no encontrado' }))
    }

    const { descripcion } = request.only(['descripcion'])
    if (!descripcion) {
      return response
        .status(422)
        .send(serialize.withoutWrapping({ error: 'descripcion es requerida' }))
    }

    const reporte = await ReporteModerador.create({
      moderadorId: user.id,
      conductorId: conductor.id,
      descripcion,
      estado: 'pendiente',
    })

    emitToAdmin('admin:moderator_report', {
      reporteId: reporte.id,
      moderador: `${user.nombre} ${user.apellido}`.trim(),
      conductorId: conductor.id,
      descripcion,
    })

    return serialize.withoutWrapping({
      id: reporte.id,
      estado: reporte.estado,
      createdAt: reporte.createdAt.toISO(),
    })
  }

  async storeEncuesta({ auth, request, response, serialize }: HttpContext) {
    const user = auth.getUserOrFail()
    const { pregunta, opciones, fechaCierre } = request.only([
      'pregunta',
      'opciones',
      'fechaCierre',
    ])

    if (!pregunta || !opciones || !Array.isArray(opciones) || opciones.length < 2) {
      return response
        .status(422)
        .send(
          serialize.withoutWrapping({ error: 'pregunta y opciones (array, min 2) son requeridos' })
        )
    }

    const encuesta = await Encuesta.create({
      moderadorId: user.id,
      zona: user.zonaModerador || '',
      pregunta,
      opciones,
      estado: 'pendiente',
      fechaCierre: fechaCierre ? DateTime.fromISO(fechaCierre) : null,
    })

    emitToAdmin('admin:new_encuesta', {
      encuestaId: encuesta.id,
      moderador: `${user.nombre} ${user.apellido}`.trim(),
      zona: encuesta.zona,
      pregunta: encuesta.pregunta,
    })

    return serialize.withoutWrapping({
      id: encuesta.id,
      pregunta: encuesta.pregunta,
      opciones: encuesta.opciones,
      estado: encuesta.estado,
      fechaCierre: encuesta.fechaCierre?.toISO() || null,
      createdAt: encuesta.createdAt.toISO(),
    })
  }

  async encuestaResults({ params, response, serialize }: HttpContext) {
    const encuesta = await Encuesta.find(params.id)
    if (!encuesta) {
      return response
        .status(404)
        .send(serialize.withoutWrapping({ error: 'Encuesta no encontrada' }))
    }

    const respuestas = await RespuestaEncuesta.query()
      .where('encuesta_id', encuesta.id)
      .preload('conductor', (q) => q.select('id', 'placa'))

    const conteo: Record<string, number> = {}
    for (const r of respuestas) {
      conteo[r.opcionElegida] = (conteo[r.opcionElegida] || 0) + 1
    }

    return serialize.withoutWrapping({
      id: encuesta.id,
      pregunta: encuesta.pregunta,
      opciones: encuesta.opciones,
      estado: encuesta.estado,
      totalRespuestas: respuestas.length,
      resultados: Object.entries(conteo).map(([opcion, total]) => ({ opcion, total })),
      respuestas: respuestas.map((r) => ({
        id: r.id,
        conductorId: r.conductorId,
        placa: r.conductor?.placa || null,
        opcionElegida: r.opcionElegida,
        createdAt: r.createdAt.toISO(),
      })),
    })
  }

  async answerEncuesta({ auth, params, request, response, serialize }: HttpContext) {
    const user = auth.getUserOrFail()
    const conductor = await Conductor.findByOrFail('usuario_id', user.id)

    const encuesta = await Encuesta.find(params.id)
    if (!encuesta) {
      return response
        .status(404)
        .send(serialize.withoutWrapping({ error: 'Encuesta no encontrada' }))
    }
    if (encuesta.estado !== 'activa') {
      return response
        .status(422)
        .send(serialize.withoutWrapping({ error: 'La encuesta no está activa' }))
    }

    const existe = await RespuestaEncuesta.query()
      .where('encuesta_id', encuesta.id)
      .where('conductor_id', conductor.id)
      .first()
    if (existe) {
      return response
        .status(400)
        .send(serialize.withoutWrapping({ error: 'Ya respondiste esta encuesta' }))
    }

    const { opcionElegida } = request.only(['opcionElegida'])
    const opciones = Array.isArray(encuesta.opciones)
      ? encuesta.opciones
      : JSON.parse(encuesta.opciones || '[]')
    if (!opcionElegida || !opciones.includes(opcionElegida)) {
      return response.status(422).send(serialize.withoutWrapping({ error: 'Opción inválida' }))
    }

    const respuesta = await RespuestaEncuesta.create({
      encuestaId: encuesta.id,
      conductorId: conductor.id,
      opcionElegida,
    })

    return serialize.withoutWrapping({
      id: respuesta.id,
      encuestaId: respuesta.encuestaId,
      opcionElegida: respuesta.opcionElegida,
      createdAt: respuesta.createdAt.toISO(),
    })
  }

  async avisosIndex({ request, serialize }: HttpContext) {
    const page = Number.parseInt(request.input('page', '1'))
    const limit = Number.parseInt(request.input('limit', '20'))
    const mensajes = await Aviso.query()
      .where('eliminado', false)
      .preload('autor', (q) => q.select('id', 'nombre', 'apellido'))
      .orderBy('fijado', 'desc')
      .orderBy('created_at', 'desc')
      .paginate(page, limit)

    return serialize.withoutWrapping(
      mensajes.all().map((m) => ({
        id: m.id,
        autor: {
          id: m.autor.id,
          nombre: `${m.autor.nombre || ''} ${m.autor.apellido || ''}`.trim(),
        },
        zona: m.zona,
        contenido: m.contenido,
        fijado: m.fijado,
        createdAt: m.createdAt.toISO(),
      }))
    )
  }

  async avisosStore({ auth, request, response, serialize }: HttpContext) {
    const user = auth.getUserOrFail()
    if (user.rol !== 'conductor' && !user.esModerador) {
      return response
        .status(403)
        .send(serialize.withoutWrapping({ error: 'Solo conductores pueden publicar avisos' }))
    }

    const { contenido } = request.only(['contenido'])
    if (!contenido || typeof contenido !== 'string' || contenido.trim().length === 0) {
      return response
        .status(422)
        .send(serialize.withoutWrapping({ error: 'El contenido no puede estar vacío' }))
    }

    const msg = await Aviso.create({
      autorId: user.id,
      zona: 'general',
      contenido: contenido.trim(),
    })

    await msg.load('autor', (q) => q.select('id', 'nombre', 'apellido'))

    const io = getIO()
    io.emit('avisos:new_message', {
      id: msg.id,
      autor: {
        id: msg.autor.id,
        nombre: `${msg.autor.nombre || ''} ${msg.autor.apellido || ''}`.trim(),
      },
      zona: msg.zona,
      contenido: msg.contenido,
      fijado: msg.fijado,
      createdAt: msg.createdAt.toISO(),
    })

    return serialize.withoutWrapping({
      id: msg.id,
      autor: {
        id: msg.autor.id,
        nombre: `${msg.autor.nombre || ''} ${msg.autor.apellido || ''}`.trim(),
      },
      zona: msg.zona,
      contenido: msg.contenido,
      fijado: msg.fijado,
      createdAt: msg.createdAt.toISO(),
    })
  }

  async avisosPin({ auth, params, response, serialize }: HttpContext) {
    const user = auth.getUserOrFail()
    if (!user.esModerador) {
      return response
        .status(403)
        .send(serialize.withoutWrapping({ error: 'Solo moderadores pueden fijar avisos' }))
    }

    const msg = await Aviso.find(params.id)
    if (!msg) {
      return response
        .status(404)
        .send(serialize.withoutWrapping({ error: 'Mensaje no encontrado' }))
    }

    msg.fijado = !msg.fijado
    await msg.save()

    return serialize.withoutWrapping({
      id: msg.id,
      fijado: msg.fijado,
    })
  }

  async avisosDelete({ auth, params, response, serialize }: HttpContext) {
    const user = auth.getUserOrFail()
    if (!user.esModerador) {
      return response
        .status(403)
        .send(serialize.withoutWrapping({ error: 'Solo moderadores pueden eliminar avisos' }))
    }

    const msg = await Aviso.find(params.id)
    if (!msg) {
      return response
        .status(404)
        .send(serialize.withoutWrapping({ error: 'Mensaje no encontrado' }))
    }

    msg.eliminado = true
    await msg.save()

    const autor = await User.find(msg.autorId)
    if (autor?.fcmToken) {
      await sendToMultiple(
        [autor.fcmToken],
        'Aviso eliminado',
        'Uno de tus avisos ha sido eliminado por un moderador.'
      )
    }

    return serialize.withoutWrapping({ success: true, id: msg.id })
  }
}
