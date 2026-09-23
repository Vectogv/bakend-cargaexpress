import User from '#models/user'
import Conductor from '#models/conductor'
import Comunicado from '#models/comunicado'
import Encuesta from '#models/encuesta'
import RespuestaEncuesta from '#models/respuesta_encuesta'
import ReporteModerador from '#models/reporte_moderador'
import Aviso from '#models/aviso'
import Viaje from '#models/viaje'
import AlertaEmergencia from '#models/alerta_emergencia'
import Oferta from '#models/oferta'
import Ganancia from '#models/ganancia'
import Disputa from '#models/disputa'
import LogFraude from '#models/log_fraude'
import Notificacion from '#models/notificacion'
import type { HttpContext } from '@adonisjs/core/http'
import { DateTime } from 'luxon'
import logger from '@adonisjs/core/services/logger'
import { sendToMultiple, sendToToken } from '#services/push_notification_service'
import TripFinalizationService from '#services/trip_finalization_service'
import {
  emitToAdmin,
  emitToModerators,
  emitToDriver,
  emitToClient,
  emitTripStatusChanged,
  getIO,
} from '#start/socket'
import { ApiOperation, ApiResponse } from '@foadonis/openapi/decorators'
import { getTripEstadoLabel } from '#services/trip_status_labels'
import { getAlertaEstadoLabel } from '#services/emergency_status_labels'
import {
  COLUMNAS_CONDUCTOR_MAPA_SOS,
  COLUMNAS_VIAJE_MAPA_SOS,
  datosMapaSos,
} from '#services/emergency_payload'
import {
  resolverZonaAlerta,
  resolverZonaViaje,
  emitTripUpdateToModerators,
} from '#services/moderator_trip_events'
import SignedUploadService from '#services/signed_upload_service'
import CoverageService, { claveDe, type Zona } from '#services/coverage_service'
import antifraudeConfig from '#config/antifraude'

export default class ModeratorController {
  async storeComunicado({ auth, request, response, serialize }: HttpContext) {
    const user = auth.getUserOrFail()
    const { titulo, contenido } = request.only(['titulo', 'contenido'])
    if (!titulo || !contenido) {
      return response
        .status(422)
        .send(await serialize.withoutWrapping({ error: 'titulo y contenido son requeridos' }))
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
    const page = Math.max(1, Number.parseInt(request.input('page', '1')) || 1)
    const limit = Math.min(100, Math.max(1, Number.parseInt(request.input('limit', '20')) || 20))
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

  async driversList({ auth, request, serialize }: HttpContext) {
    const user = auth.getUserOrFail()
    const page = Math.max(1, Number.parseInt(request.input('page', '1')) || 1)
    const limit = Math.min(100, Math.max(1, Number.parseInt(request.input('limit', '20')) || 20))
    const estado = request.input('estado') || null
    const ciudad = user.esModerador
      ? user.zonaModerador
      : user.rol === 'admin'
        ? request.input('ciudad') || null
        : null

    const conductores = await Conductor.query()
      .if(ciudad, (q) => q.where('ciudad', ciudad!))
      .if(estado, (q) => q.where('estado_verificacion', estado!))
      .preload('usuario', (q) => q.select('id', 'nombre', 'apellido', 'telefono', 'email'))
      .orderBy('created_at', 'desc')
      .paginate(page, limit)

    return serialize.withoutWrapping(
      conductores.all().map((c) => ({
        id: c.id,
        usuarioId: c.usuarioId,
        cedula: c.cedula,
        placa: c.placa,
        tipoVehiculo: c.tipoVehiculo,
        capacidad: c.capacidad,
        ciudad: c.ciudad,
        fotoConductor: c.fotoConductor,
        fotoVehiculo: c.fotoVehiculo,
        online: c.online,
        calificacion: c.calificacion,
        totalViajes: c.totalViajes,
        horasActivo: c.horasActivo,
        ultimaUbicacion: c.ultimaUbicacionLat
          ? { lat: c.ultimaUbicacionLat, lng: c.ultimaUbicacionLng }
          : null,
        estadoVerificacion: c.estadoVerificacion,
        fotoCedula: SignedUploadService.sign(c.fotoCedula),
        fotoLicencia: SignedUploadService.sign(c.fotoLicencia),
        notaRechazo: c.notaRechazo,
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

  async inactiveDrivers({ auth, request, serialize }: HttpContext) {
    const user = auth.getUserOrFail()
    const ciudad = user.esModerador
      ? user.zonaModerador
      : user.rol === 'admin'
        ? request.input('ciudad') || null
        : null
    const fechaLimite = DateTime.now().minus({ days: 7 }).toSQL()
    const page = Math.max(1, Number.parseInt(request.input('page', '1')) || 1)
    const limit = Math.min(100, Math.max(1, Number.parseInt(request.input('limit', '20')) || 20))

    const conductores = await Conductor.query()
      .if(ciudad, (q) => q.where('ciudad', ciudad!))
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
        cedula: c.cedula,
        placa: c.placa,
        tipoVehiculo: c.tipoVehiculo,
        capacidad: c.capacidad,
        ciudad: c.ciudad,
        fotoConductor: c.fotoConductor,
        fotoVehiculo: c.fotoVehiculo,
        online: c.online,
        calificacion: c.calificacion,
        totalViajes: c.totalViajes,
        horasActivo: c.horasActivo,
        ultimaUbicacion: c.ultimaUbicacionLat
          ? { lat: c.ultimaUbicacionLat, lng: c.ultimaUbicacionLng }
          : null,
        estadoVerificacion: c.estadoVerificacion,
        fotoCedula: SignedUploadService.sign(c.fotoCedula),
        fotoLicencia: SignedUploadService.sign(c.fotoLicencia),
        notaRechazo: c.notaRechazo,
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

  async notifyDriver({ auth, params, response, serialize }: HttpContext) {
    const user = auth.getUserOrFail()
    const conductor = await Conductor.find(params.id)
    if (!conductor) {
      return response
        .status(404)
        .send(await serialize.withoutWrapping({ error: 'Conductor no encontrado' }))
    }

    if (user.zonaModerador && claveDe(conductor.ciudad || '') !== claveDe(user.zonaModerador)) {
      return response
        .status(403)
        .send(await serialize.withoutWrapping({ error: 'Este conductor no pertenece a tu ciudad' }))
    }

    const usuario = await User.find(conductor.usuarioId)
    if (!usuario?.fcmToken) {
      return response
        .status(422)
        .send(await serialize.withoutWrapping({ error: 'El conductor no tiene token FCM' }))
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
        .send(await serialize.withoutWrapping({ error: 'Conductor no encontrado' }))
    }

    if (user.zonaModerador && claveDe(conductor.ciudad || '') !== claveDe(user.zonaModerador)) {
      return response
        .status(403)
        .send(await serialize.withoutWrapping({ error: 'Este conductor no pertenece a tu ciudad' }))
    }

    const { descripcion } = request.only(['descripcion'])
    if (!descripcion) {
      return response
        .status(422)
        .send(await serialize.withoutWrapping({ error: 'descripcion es requerida' }))
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

  async approveDriver({ auth, params, response, serialize }: HttpContext) {
    const user = auth.getUserOrFail()
    const conductor = await Conductor.find(params.id)
    if (!conductor) {
      return response
        .status(404)
        .send(await serialize.withoutWrapping({ error: 'Conductor no encontrado' }))
    }

    const esAdmin = user.rol === 'admin'
    if (!esAdmin && user.zonaModerador && claveDe(conductor.ciudad || '') !== claveDe(user.zonaModerador)) {
      return response
        .status(403)
        .send(await serialize.withoutWrapping({ error: 'No puedes verificar conductores de otra ciudad' }))
    }

    conductor.estadoVerificacion = 'aprobado'
    conductor.notaRechazo = null
    await conductor.save()

    try {
      emitToDriver(conductor.usuarioId, 'driver:approved', {
        conductorId: conductor.id,
        estado: conductor.estadoVerificacion,
      })
      if (esAdmin && conductor.ciudad) {
        emitToModerators(conductor.ciudad, 'moderator:driver_verified', {
          conductorId: conductor.id,
          ciudad: conductor.ciudad,
          estado: 'aprobado',
        })
      }
    } catch {
      // socket no disponible
    }

    return serialize.withoutWrapping({
      conductorId: conductor.id,
      estadoVerificacion: conductor.estadoVerificacion,
    })
  }

  async rejectDriver({ auth, params, request, response, serialize }: HttpContext) {
    const user = auth.getUserOrFail()
    const conductor = await Conductor.find(params.id)
    if (!conductor) {
      return response
        .status(404)
        .send(await serialize.withoutWrapping({ error: 'Conductor no encontrado' }))
    }

    const esAdmin = user.rol === 'admin'
    if (!esAdmin && user.zonaModerador && claveDe(conductor.ciudad || '') !== claveDe(user.zonaModerador)) {
      return response
        .status(403)
        .send(await serialize.withoutWrapping({ error: 'No puedes verificar conductores de otra ciudad' }))
    }

    const { nota } = request.only(['nota'])
    conductor.estadoVerificacion = 'rechazado'
    conductor.notaRechazo = nota || null
    await conductor.save()

    try {
      emitToDriver(conductor.usuarioId, 'driver:rejected', {
        conductorId: conductor.id,
        estado: conductor.estadoVerificacion,
        nota: conductor.notaRechazo,
      })
      if (esAdmin && conductor.ciudad) {
        emitToModerators(conductor.ciudad, 'moderator:driver_verified', {
          conductorId: conductor.id,
          ciudad: conductor.ciudad,
          estado: 'rechazado',
        })
      }
    } catch {
      // socket no disponible
    }

    return serialize.withoutWrapping({
      conductorId: conductor.id,
      estadoVerificacion: conductor.estadoVerificacion,
      nota: conductor.notaRechazo,
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
          await serialize.withoutWrapping({ error: 'pregunta y opciones (array, min 2) son requeridos' })
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

  async encuestaResults({ auth, params, response, serialize }: HttpContext) {
    const user = auth.getUserOrFail()
    const encuesta = await Encuesta.find(params.id)
    if (!encuesta) {
      return response
        .status(404)
        .send(await serialize.withoutWrapping({ error: 'Encuesta no encontrada' }))
    }
    // Un moderador solo ve resultados de encuestas de su zona (o las generales).
    const zonaEncuesta = String(encuesta.zona || '').trim().toLowerCase()
    const zonaUsuario = String(user.zonaModerador || '').trim().toLowerCase()
    if (user.rol !== 'admin' && zonaEncuesta && zonaEncuesta !== 'general' && zonaEncuesta !== zonaUsuario) {
      return response
        .status(403)
        .send(await serialize.withoutWrapping({ error: 'La encuesta pertenece a otra ciudad' }))
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
        .send(await serialize.withoutWrapping({ error: 'Encuesta no encontrada' }))
    }
    if (encuesta.estado !== 'activa') {
      return response
        .status(422)
        .send(await serialize.withoutWrapping({ error: 'La encuesta no está activa' }))
    }

    const existe = await RespuestaEncuesta.query()
      .where('encuesta_id', encuesta.id)
      .where('conductor_id', conductor.id)
      .first()
    if (existe) {
      return response
        .status(400)
        .send(await serialize.withoutWrapping({ error: 'Ya respondiste esta encuesta' }))
    }

    const { opcionElegida } = request.only(['opcionElegida'])
    const opciones = Array.isArray(encuesta.opciones)
      ? encuesta.opciones
      : JSON.parse(encuesta.opciones || '[]')
    if (!opcionElegida || !opciones.includes(opcionElegida)) {
      return response.status(422).send(await serialize.withoutWrapping({ error: 'Opción inválida' }))
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
    const page = Math.max(1, Number.parseInt(request.input('page', '1')) || 1)
    const limit = Math.min(100, Math.max(1, Number.parseInt(request.input('limit', '20')) || 20))
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
    if (user.rol !== 'conductor' && !user.esModerador && user.rol !== 'admin') {
      return response
        .status(403)
        .send(await serialize.withoutWrapping({ error: 'Solo conductores pueden publicar avisos' }))
    }

    const { contenido } = request.only(['contenido'])
    if (!contenido || typeof contenido !== 'string' || contenido.trim().length === 0) {
      return response
        .status(422)
        .send(await serialize.withoutWrapping({ error: 'El contenido no puede estar vacío' }))
    }

    const msg = await Aviso.create({
      autorId: user.id,
      zona: 'general',
      contenido: contenido.trim(),
    })

    await msg.load('autor', (q) => q.select('id', 'nombre', 'apellido'))

    try {
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
    } catch {
      // Socket.io no disponible (ej. tests): el aviso se persiste igual
    }

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
    if (!user.esModerador && user.rol !== 'admin') {
      return response
        .status(403)
        .send(await serialize.withoutWrapping({ error: 'Solo moderadores pueden fijar avisos' }))
    }

    const msg = await Aviso.find(params.id)
    if (!msg) {
      return response
        .status(404)
        .send(await serialize.withoutWrapping({ error: 'Mensaje no encontrado' }))
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
    if (!user.esModerador && user.rol !== 'admin') {
      return response
        .status(403)
        .send(await serialize.withoutWrapping({ error: 'Solo moderadores pueden eliminar avisos' }))
    }

    const msg = await Aviso.find(params.id)
    if (!msg) {
      return response
        .status(404)
        .send(await serialize.withoutWrapping({ error: 'Mensaje no encontrado' }))
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

  async myEncuestas({ auth, request, serialize }: HttpContext) {
    const user = auth.getUserOrFail()
    const page = Math.max(1, Number.parseInt(request.input('page', '1')) || 1)
    const limit = Math.min(100, Math.max(1, Number.parseInt(request.input('limit', '20')) || 20))
    const encuestas = await Encuesta.query()
      .where('moderador_id', user.id)
      .orderBy('created_at', 'desc')
      .paginate(page, limit)

    return serialize.withoutWrapping(
      encuestas.all().map((e) => ({
        id: e.id,
        zona: e.zona,
        pregunta: e.pregunta,
        opciones: e.opciones,
        estado: e.estado,
        fechaCierre: e.fechaCierre?.toISO() || null,
        createdAt: e.createdAt.toISO(),
      }))
    )
  }

  async myReports({ auth, request, serialize }: HttpContext) {
    const user = auth.getUserOrFail()
    const page = Math.max(1, Number.parseInt(request.input('page', '1')) || 1)
    const limit = Math.min(100, Math.max(1, Number.parseInt(request.input('limit', '20')) || 20))
    const reportes = await ReporteModerador.query()
      .where('moderador_id', user.id)
      .orderBy('created_at', 'desc')
      .paginate(page, limit)

    return serialize.withoutWrapping(
      reportes.all().map((r) => ({
        id: r.id,
        conductorId: r.conductorId,
        descripcion: r.descripcion,
        estado: r.estado,
        createdAt: r.createdAt.toISO(),
      }))
    )
  }

  async dashboard({ auth, request, serialize }: HttpContext) {
    const user = auth.getUserOrFail()
    const ciudad = user.esModerador
      ? user.zonaModerador
      : user.rol === 'admin'
        ? request.input('ciudad') || null
        : null
    const fechaLimite = DateTime.now().minus({ days: 7 }).toSQL()

    const [totalDrivers, inactiveDrivers, onlineDrivers, totalComunicados, totalAvisos, totalReports] =
      await Promise.all([
        Conductor.query().if(ciudad, (q) => q.where('ciudad', ciudad!)).count('* as total').first(),
        Conductor.query()
          .if(ciudad, (q) => q.where('ciudad', ciudad!))
          .where('online', false)
          .whereNotExists((q) => {
            q.from('viajes')
              .whereRaw('viajes.conductor_id = conductores.id')
              .where('viajes.created_at', '>=', fechaLimite)
          })
          .count('* as total')
          .first(),
        Conductor.query()
          .if(ciudad, (q) => q.where('ciudad', ciudad!))
          .where('online', true)
          .count('* as total')
          .first(),
        Comunicado.query().where('moderador_id', user.id).count('* as total').first(),
        Aviso.query().where('zona', ciudad || 'general').count('* as total').first(),
        ReporteModerador.query().where('moderador_id', user.id).count('* as total').first(),
      ])

    return serialize.withoutWrapping({
      ciudad: ciudad || null,
      totalDrivers: Number(totalDrivers?.$extras?.total || 0),
      inactiveDrivers: Number(inactiveDrivers?.$extras?.total || 0),
      onlineDrivers: Number(onlineDrivers?.$extras?.total || 0),
      totalComunicados: Number(totalComunicados?.$extras?.total || 0),
      totalAvisos: Number(totalAvisos?.$extras?.total || 0),
      totalReports: Number(totalReports?.$extras?.total || 0),
    })
  }

  async trips({ auth, request, serialize, response }: HttpContext) {
    const user = auth.getUserOrFail()
    const ciudad = user.zonaModerador
    if (!ciudad) {
      return response
        .status(403)
        .send(await serialize.withoutWrapping({ error: 'No tienes ciudad asignada' }))
    }

    const page = Math.max(1, Number.parseInt(request.input('page', '1')) || 1)
    const limit = Math.min(100, Math.max(1, Number.parseInt(request.input('limit', '20')) || 20))
    const estado = request.input('estado', '')
    const tipoProgramacion = request.input('tipoProgramacion', '')

    const resultado = await Viaje.query()
      .whereNotNull('conductor_id')
      .whereExists((q) => {
        q.from('conductores')
          .whereRaw('conductores.id = viajes.conductor_id')
          .where('conductores.ciudad', ciudad)
      })
      .if(estado, (q) => q.whereIn('estado', String(estado).split(',')))
      .if(tipoProgramacion, (q) => q.where('tipo_programacion', String(tipoProgramacion)))
      .preload('cliente', (q) => q.select('id', 'nombre', 'apellido', 'telefono', 'email'))
      .preload('conductor', (q) =>
        q
          .select('id', 'usuario_id', 'placa', 'tipo_vehiculo', 'ciudad')
          .preload('usuario', (uq) => uq.select('id', 'nombre', 'apellido', 'telefono'))
      )
      .orderBy('created_at', 'desc')
      .paginate(page, limit)

    return serialize.withoutWrapping(
      resultado.all().map((t) => ({
        id: t.id,
        clienteId: t.clienteId,
        conductorId: t.conductorId,
        estado: t.estado,
        estadoLabel: getTripEstadoLabel(t.estado),
        origenDireccion: t.origenDireccion,
        origen: { lat: t.origenLat, lng: t.origenLng },
        destinoDireccion: t.destinoDireccion,
        destino: { lat: t.destinoLat, lng: t.destinoLng },
        carga: t.carga,
        tipoProgramacion: t.tipoProgramacion ?? 'inmediata',
        fechaProgramada: t.fechaProgramada,
        horaProgramada: t.horaProgramada,
        activacionAt: t.activacionAt?.toISO() ?? null,
        precioEstimado: t.precioEstimado,
        precioFinal: t.precioFinal,
        motivoCancelacion: t.motivoCancelacion,
        calificacionCliente: t.calificacionCliente,
        cliente: t.cliente
          ? {
              id: t.cliente.id,
              nombre: `${t.cliente.nombre || ''} ${t.cliente.apellido || ''}`.trim(),
              telefono: t.cliente.telefono,
              email: t.cliente.email,
            }
          : null,
        conductor: t.conductor
          ? {
              id: t.conductor.id,
              placa: t.conductor.placa,
              tipoVehiculo: t.conductor.tipoVehiculo,
              ciudad: t.conductor.ciudad,
              nombre: `${t.conductor.usuario?.nombre || ''} ${t.conductor.usuario?.apellido || ''}`.trim(),
              telefono: t.conductor.usuario?.telefono,
            }
          : null,
        createdAt: t.createdAt.toISO(),
        aceptadoAt: t.aceptadoAt?.toISO() ?? null,
        enCursoAt: t.enCursoAt?.toISO() ?? null,
        completadoAt: t.completadoAt?.toISO() ?? null,
        finalizadoAt: t.finalizadoAt?.toISO() ?? null,
        canceladoAt: t.canceladoAt?.toISO() ?? null,
      }))
    )
  }

  async tripShow({ auth, params, serialize, response }: HttpContext) {
    const user = auth.getUserOrFail()
    const ciudad = user.zonaModerador
    if (!ciudad) {
      return response
        .status(403)
        .send(await serialize.withoutWrapping({ error: 'No tienes ciudad asignada' }))
    }

    const viaje = await Viaje.query()
      .where('id', params.id)
      .whereExists((q) => {
        q.from('conductores')
          .whereRaw('conductores.id = viajes.conductor_id')
          .where('conductores.ciudad', ciudad)
      })
      .preload('cliente', (q) => q.select('id', 'nombre', 'apellido', 'telefono', 'email', 'avatar'))
      .preload('conductor', (q) =>
        q
          .select('id', 'usuario_id', 'placa', 'tipo_vehiculo', 'foto_vehiculo', 'ciudad', 'calificacion', 'total_viajes', 'online')
          .preload('usuario', (uq) => uq.select('id', 'nombre', 'apellido', 'telefono', 'email'))
      )
      .first()

    if (!viaje) {
      return response
        .status(404)
        .send(await serialize.withoutWrapping({ error: 'Viaje no encontrado en tu ciudad' }))
    }

    const [ofertas, alertas, ganancias] = await Promise.all([
      Oferta.query()
        .where('viaje_id', viaje.id)
        .orderBy('created_at', 'desc')
        .preload('conductor', (q) =>
          q.select('id', 'usuario_id', 'placa', 'tipo_vehiculo').preload('usuario', (uq) => uq.select('id', 'nombre', 'apellido'))
        ),
      AlertaEmergencia.query()
        .where('viaje_id', viaje.id)
        .orderBy('created_at', 'desc')
        .preload('usuario', (q) => q.select('id', 'nombre', 'apellido', 'telefono'))
        .preload('moderadorAtendio', (q) => q.select('id', 'nombre', 'apellido'))
        .preload('moderadorResolvio', (q) => q.select('id', 'nombre', 'apellido')),
      Ganancia.query().where('viaje_id', viaje.id).orderBy('created_at', 'desc'),
    ])

    return serialize.withoutWrapping({
      id: Number(viaje.id),
      estado: viaje.estado,
      estadoLabel: getTripEstadoLabel(viaje.estado),
      cliente: viaje.cliente
        ? {
            id: viaje.cliente.id,
            nombre: `${viaje.cliente.nombre || ''} ${viaje.cliente.apellido || ''}`.trim(),
            telefono: viaje.cliente.telefono,
            email: viaje.cliente.email,
            avatar: viaje.cliente.avatar,
          }
        : null,
      conductor: viaje.conductor
        ? {
            id: viaje.conductor.id,
            nombre: `${viaje.conductor.usuario?.nombre || ''} ${viaje.conductor.usuario?.apellido || ''}`.trim(),
            telefono: viaje.conductor.usuario?.telefono,
            email: viaje.conductor.usuario?.email,
            placa: viaje.conductor.placa,
            tipoVehiculo: viaje.conductor.tipoVehiculo,
            fotoVehiculo: viaje.conductor.fotoVehiculo,
            ciudad: viaje.conductor.ciudad,
            calificacion: viaje.conductor.calificacion,
            totalViajes: viaje.conductor.totalViajes,
            online: viaje.conductor.online,
          }
        : null,
      origen: {
        direccion: viaje.origenDireccion,
        lat: Number(viaje.origenLat),
        lng: Number(viaje.origenLng),
      },
      destino: {
        direccion: viaje.destinoDireccion,
        lat: Number(viaje.destinoLat),
        lng: Number(viaje.destinoLng),
      },
      carga: viaje.carga,
      fotoEntrega: viaje.fotoEntrega,
      tiempoEstimadoMinutos: viaje.tiempoEstimadoMinutos !== null ? Number(viaje.tiempoEstimadoMinutos) : null,
      dinero: {
        precioCliente: viaje.precioCliente !== null ? Number(viaje.precioCliente) : null,
        precioEstimado: viaje.precioEstimado !== null ? Number(viaje.precioEstimado) : null,
        precioFinal: viaje.precioFinal !== null ? Number(viaje.precioFinal) : null,
        ofertaAceptada: ofertas.find((o) => o.estado === 'aceptada')?.monto ? Number(ofertas.find((o) => o.estado === 'aceptada')!.monto) : null,
      },
      timestamps: {
        creado: viaje.createdAt?.toISO() ?? null,
        aceptado: viaje.aceptadoAt?.toISO() ?? null,
        enCurso: viaje.enCursoAt?.toISO() ?? null,
        completado: viaje.completadoAt?.toISO() ?? null,
        finalizado: viaje.finalizadoAt?.toISO() ?? null,
        cancelado: viaje.canceladoAt?.toISO() ?? null,
      },
      motivoCancelacion: viaje.motivoCancelacion,
      calificacionCliente: viaje.calificacionCliente,
      ofertas: ofertas.map((o) => ({
        id: o.id,
        monto: Number(o.monto),
        estado: o.estado,
        createdAt: o.createdAt?.toISO() ?? null,
        conductor: o.conductor
          ? {
              id: o.conductor.id,
              nombre: `${o.conductor.usuario?.nombre || ''} ${o.conductor.usuario?.apellido || ''}`.trim(),
              placa: o.conductor.placa,
              tipoVehiculo: o.conductor.tipoVehiculo,
            }
          : null,
      })),
      alertas: alertas.map((a) => ({
        id: a.id,
        estado: a.estado,
        estadoLabel: getAlertaEstadoLabel(a.estado),
        motivo: a.motivo,
        lat: a.lat !== null ? Number(a.lat) : null,
        lng: a.lng !== null ? Number(a.lng) : null,
        usuario: a.usuario
          ? {
              nombre: `${a.usuario.nombre || ''} ${a.usuario.apellido || ''}`.trim(),
              telefono: a.usuario.telefono,
            }
          : null,
        atendidoPor: a.moderadorAtendio
          ? `${a.moderadorAtendio.nombre || ''} ${a.moderadorAtendio.apellido || ''}`.trim()
          : null,
        resueltoPor: a.moderadorResolvio
          ? `${a.moderadorResolvio.nombre || ''} ${a.moderadorResolvio.apellido || ''}`.trim()
          : null,
        observacion: a.observacion,
        atendidaAt: a.atendidaAt?.toISO() ?? null,
        resueltaAt: a.resueltaAt?.toISO() ?? null,
        createdAt: a.createdAt?.toISO() ?? null,
      })),
      ganancias: ganancias.map((g) => ({
        montoBruto: g.montoBruto !== null ? Number(g.montoBruto) : null,
        comision: g.comision !== null ? Number(g.comision) : null,
        montoNeto: g.montoNeto !== null ? Number(g.montoNeto) : null,
        comisionPagada: g.comisionPagada,
        comisionPagadaAt: g.comisionPagadaAt?.toISO() ?? null,
      })),
    })
  }

  @ApiOperation({
    summary: 'Resolver un cierre pendiente de confirmación (H1)',
    description:
      'Cuando el cliente no confirma el cierre dentro del tiempo límite, el moderador de la zona (o un admin) finaliza el viaje o lo deriva a disputa.',
  })
  @ApiResponse({ type: 'object' })
  async resolvePendingClose({ auth, params, request, response, serialize }: HttpContext) {
    const user = auth.getUserOrFail()
    const viaje = await Viaje.find(params.id)
    if (!viaje) {
      return response.status(404).json({ error: 'Viaje no encontrado' })
    }

    if (viaje.estado !== 'pendiente_confirmacion') {
      return response
        .status(422)
        .json({
          error: `El viaje no está pendiente de confirmación (estado actual: ${viaje.estado})`,
        })
    }

    // Moderador: solo de su zona (comparación normalizada). Admin: cualquier zona.
    if (user.rol !== 'admin') {
      if (!user.zonaModerador) {
        return response.status(403).json({ error: 'No tienes una zona asignada' })
      }

      const zona = await resolverZonaViaje(viaje)
      if (!zona) {
        return response.status(403).json({ error: 'No se pudo determinar la zona del viaje' })
      }

      if (claveDe(zona) !== claveDe(user.zonaModerador)) {
        return response.status(403).json({ error: 'El viaje pertenece a otra ciudad' })
      }
    }

    // El cliente tiene `confirmacionTimeoutMin` minutos para confirmar o
    // rechazar el cierre; antes de eso nadie puede resolverlo por él.
    // (Viajes antiguos sin `pendienteConfirmacionDesde` no se bloquean.)
    if (viaje.pendienteConfirmacionDesde) {
      const plazo = viaje.pendienteConfirmacionDesde.plus({
        minutes: antifraudeConfig.confirmacionTimeoutMin,
      })
      if (DateTime.now() < plazo) {
        const minutosRestantes = Math.max(1, Math.ceil(plazo.diffNow('minutes').minutes))
        return response.status(409).json({
          error: `El cliente todavía está dentro del plazo para confirmar el cierre. Podrás resolverlo en ${minutosRestantes} min.`,
          code: 'CONFIRMACION_EN_PLAZO',
          minutosRestantes,
        })
      }
    }

    const { resolucion, nota } = request.only(['resolucion', 'nota'])
    if (!['finalizar', 'disputa'].includes(resolucion)) {
      return response
        .status(422)
        .json({ error: 'resolucion debe ser "finalizar" o "disputa"' })
    }
    if (!nota || String(nota).trim().length < 10) {
      return response
        .status(422)
        .json({ error: 'La nota debe tener al menos 10 caracteres' })
    }

    const viajeId = Number(viaje.id)
    const conductor = viaje.conductorId ? await Conductor.find(viaje.conductorId) : null
    const notaResolucion = String(nota).trim()

    if (resolucion === 'finalizar') {
      const montoFinal = viaje.precioFinal ?? viaje.precioCliente ?? viaje.precioEstimado ?? 0
      const result = await TripFinalizationService.finalize({
        viajeId,
        montoFinal,
        actorUserId: user.id,
        actorRol: 'moderador',
      })

      if (!result.ok) {
        return response.status(result.statusCode).send({ error: result.error })
      }

      try {
        await LogFraude.create({
          userId: user.id,
          conductorId: conductor?.id ?? null,
          tipo: 'cierre_resuelto_moderador',
          descripcion: `Moderador finalizó cierre sin confirmación del cliente. Nota: ${notaResolucion}`,
          metadata: { viajeId, nota: notaResolucion },
        })
      } catch (e) {
        logger.error({ err: e, viajeId }, 'Error auditando cierre resuelto por moderador')
      }

      const viajeFinalizado = await Viaje.find(Number(result.viaje.id))
      if (viajeFinalizado) {
        emitTripStatusChanged(viajeFinalizado.clienteId, conductor?.usuarioId, {
          id: String(viajeFinalizado.id),
          estado: 'finalizado',
          montoFinal: result.viaje.montoFinal,
          finalizadoAt: result.viaje.finalizadoAt,
          notificadoPor: 'moderador',
        })
        emitTripUpdateToModerators(viajeFinalizado)
      }

      return serialize.withoutWrapping({
        id: result.viaje.id,
        estado: 'finalizado',
        montoFinal: result.viaje.montoFinal,
        finalizadoAt: result.viaje.finalizadoAt,
        resueltoPor: `${user.nombre} ${user.apellido}`.trim(),
        nota: notaResolucion,
      })
    }

    // resolucion === 'disputa': sin conductor no se puede abrir disputa
    if (!conductor) {
      return response
        .status(422)
        .json({ error: 'El viaje no tiene conductor asignado para abrir disputa' })
    }

    const disputa = await Disputa.create({
      viajeId: viaje.id,
      conductorId: conductor.id,
      clienteId: viaje.clienteId,
      estado: 'abierta',
      problema: 'cierre_sin_confirmar',
      descripcion: notaResolucion,
      versionConductor: 'Conductor solicitó cierre del servicio',
      versionCliente: 'Cliente no confirmó el cierre dentro del tiempo límite',
    })

    viaje.estado = 'disputa'
    await viaje.save()

    try {
      await LogFraude.create({
        userId: user.id,
        conductorId: conductor.id,
        tipo: 'cierre_disputa_moderador',
        descripcion: `Moderador derivó cierre sin confirmar a disputa. Nota: ${notaResolucion}`,
        metadata: { viajeId, nota: notaResolucion },
      })
    } catch (e) {
      logger.error({ err: e, viajeId }, 'Error auditando disputa por moderador')
    }

    await Notificacion.create({
      usuarioId: viaje.clienteId,
      tipo: 'disputa_cierre',
      titulo: 'Tu cierre fue revisado',
      mensaje: `El viaje #${viaje.id} fue abierto como disputa. Un moderador lo está revisando.`,
      leido: false,
    })

    const clienteUsuario = await User.find(viaje.clienteId)
    if (clienteUsuario?.fcmToken) {
      await sendToToken(
        clienteUsuario.fcmToken,
        'Tu cierre fue revisado',
        `El viaje #${viaje.id} fue abierto como disputa. Un moderador lo está revisando.`
      )
    }

    emitTripStatusChanged(viaje.clienteId, conductor.usuarioId, {
      id: String(viaje.id),
      estado: 'disputa',
      disputaId: disputa.id,
      notificadoPor: 'moderador',
    })

    emitToClient(viaje.clienteId, 'trip:close_rejected', {
      viajeId: String(viaje.id),
      estado: 'disputa',
      disputaId: disputa.id,
    })

    emitToDriver(conductor.usuarioId, 'trip:close_rejected', {
      viajeId: String(viaje.id),
      estado: 'disputa',
      disputaId: disputa.id,
      motivo: notaResolucion,
    })

    emitTripUpdateToModerators(viaje)

    return serialize.withoutWrapping({
      id: String(viaje.id),
      estado: 'disputa',
      disputaId: disputa.id,
      resueltoPor: `${user.nombre} ${user.apellido}`.trim(),
      nota: notaResolucion,
    })
  }

  @ApiOperation({
    summary: 'Reservas programadas de la ciudad',
    description:
      'Lista las reservas programadas de la ciudad del moderador, incluyendo las que todavía no tienen conductor asignado.',
  })
  @ApiResponse({ type: 'array' })
  async reservations({ auth, request, serialize, response }: HttpContext) {
    const user = auth.getUserOrFail()
    const ciudad = user.zonaModerador
    if (!ciudad) {
      return response
        .status(403)
        .send(await serialize.withoutWrapping({ error: 'No tienes ciudad asignada' }))
    }

    const page = Math.max(1, Number.parseInt(request.input('page', '1')) || 1)
    const limit = Math.min(100, Math.max(1, Number.parseInt(request.input('limit', '20')) || 20))
    const estado = request.input('estado', '')
    const fecha = request.input('fecha')
    const origen = request.input('origen')
    const destino = request.input('destino')
    const conductorId = request.input('conductorId')
    const proximas = request.input('proximas')

    // Las reservas sin conductor no pueden filtrarse por ciudad en SQL, por lo
    // que la zona se resuelve por origen sobre un conjunto acotado de candidatas.
    const candidatas = await Viaje.query()
      .where('tipo_programacion', 'programada')
      .if(estado, (q) => q.whereIn('estado', String(estado).split(',').map((s) => s.trim()).filter(Boolean)))
      .if(fecha, (q) => q.where('fecha_programada', String(fecha)))
      .if(conductorId, (q) => q.where('conductor_id', Number(conductorId)))
      .if(origen, (q) =>
        q.whereRaw('LOWER(origen_direccion) LIKE ?', [`%${String(origen).toLowerCase()}%`])
      )
      .if(destino, (q) =>
        q.whereRaw('LOWER(destino_direccion) LIKE ?', [`%${String(destino).toLowerCase()}%`])
      )
      .if(proximas === true || proximas === 'true', (q) =>
        q.whereIn('estado', [
          'reservado',
          'buscando_conductor',
          'pendiente',
          'aceptado',
          'conductor_en_camino',
          'conductor_llegada',
          'en_curso',
        ])
      )
      .preload('cliente', (q) => q.select('id', 'nombre', 'apellido', 'telefono', 'email'))
      .preload('conductor', (q) =>
        q
          .select('id', 'usuario_id', 'placa', 'tipo_vehiculo', 'ciudad')
          .preload('usuario', (uq) => uq.select('id', 'nombre', 'apellido', 'telefono'))
      )
      .orderBy('fecha_programada', 'asc')
      .orderBy('hora_programada', 'asc')
      .limit(200)

    const zonas = await CoverageService.zonas()
    const ciudadLower = String(ciudad).toLowerCase()

    const enCiudad = candidatas.filter((v) => {
      const zona = this.zonaDeReserva(v, zonas)
      return zona !== null && zona === ciudadLower
    })

    const total = enCiudad.length
    const inicio = (page - 1) * limit
    const pagina = enCiudad.slice(inicio, inicio + limit)

    return serialize.withoutWrapping({
      data: pagina.map((t) => ({
        id: t.id,
        clienteId: t.clienteId,
        conductorId: t.conductorId,
        estado: t.estado,
        estadoLabel: getTripEstadoLabel(t.estado),
        tipoProgramacion: t.tipoProgramacion ?? 'programada',
        fechaProgramada: t.fechaProgramada,
        horaProgramada: t.horaProgramada,
        activacionAt: t.activacionAt?.toISO() ?? null,
        origenDireccion: t.origenDireccion,
        origen: { lat: t.origenLat, lng: t.origenLng },
        destinoDireccion: t.destinoDireccion,
        destino: { lat: t.destinoLat, lng: t.destinoLng },
        carga: t.carga,
        precioEstimado: t.precioEstimado,
        precioFinal: t.precioFinal,
        motivoCancelacion: t.motivoCancelacion,
        cliente: t.cliente
          ? {
              id: t.cliente.id,
              nombre: `${t.cliente.nombre || ''} ${t.cliente.apellido || ''}`.trim(),
              telefono: t.cliente.telefono,
              email: t.cliente.email,
            }
          : null,
        conductor: t.conductor
          ? {
              id: t.conductor.id,
              placa: t.conductor.placa,
              tipoVehiculo: t.conductor.tipoVehiculo,
              ciudad: t.conductor.ciudad,
              nombre: `${t.conductor.usuario?.nombre || ''} ${t.conductor.usuario?.apellido || ''}`.trim(),
              telefono: t.conductor.usuario?.telefono,
            }
          : null,
        createdAt: t.createdAt.toISO(),
        aceptadoAt: t.aceptadoAt?.toISO() ?? null,
        finalizadoAt: t.finalizadoAt?.toISO() ?? null,
        canceladoAt: t.canceladoAt?.toISO() ?? null,
      })),
      total,
      page,
      limit,
    })
  }

  /**
   * Resuelve la ciudad/zona de una reserva: la del conductor asignado o, si
   * aún no tiene, la zona de cobertura más cercana a su origen.
   */
  private zonaDeReserva(viaje: Viaje, zonas: Zona[]): string | null {
    if (viaje.conductor?.ciudad) return String(viaje.conductor.ciudad).toLowerCase()
    if (viaje.origenLat === null || viaje.origenLng === null) return null
    return CoverageService.zonaDeEn(zonas, Number(viaje.origenLat), Number(viaje.origenLng))?.clave ?? null
  }

  private ciudadDeEmergencia(ciudad: string) {
    return (q: any) => {
      q.whereExists((sub: any) => {
        sub
          .from('viajes')
          .whereRaw('viajes.id = alertas_emergencia.viaje_id')
          .whereExists((sub2: any) => {
            sub2
              .from('conductores')
              .whereRaw('conductores.id = viajes.conductor_id')
              .where('conductores.ciudad', ciudad)
          })
      }).orWhereExists((sub: any) => {
        sub
          .from('conductores')
          .whereRaw('conductores.usuario_id = alertas_emergencia.user_id')
          .where('conductores.ciudad', ciudad)
      })
    }
  }

  async emergencyCount({ auth, serialize, response }: HttpContext) {
    const user = auth.getUserOrFail()
    const ciudad = user.zonaModerador
    if (!ciudad) {
      return response
        .status(403)
        .send(await serialize.withoutWrapping({ error: 'No tienes ciudad asignada' }))
    }

    const filas = await AlertaEmergencia.query()
      .where(this.ciudadDeEmergencia(ciudad))
      .select('estado')
      .count('* as total')
      .groupBy('estado')

    let pendientes = 0
    let atendidas = 0
    let resueltas = 0
    for (const f of filas) {
      const total = Number(f.$extras?.total || 0)
      if (f.estado === 'pendiente') pendientes = total
      else if (f.estado === 'atendida') atendidas = total
      else if (f.estado === 'resuelta') resueltas = total
    }

    return serialize.withoutWrapping({ pendientes, atendidas, resueltas })
  }

  async emergencies({ auth, request, serialize, response }: HttpContext) {
    const user = auth.getUserOrFail()
    const ciudad = user.zonaModerador
    if (!ciudad) {
      return response
        .status(403)
        .send(await serialize.withoutWrapping({ error: 'No tienes ciudad asignada' }))
    }

    const page = Math.max(1, Number.parseInt(request.input('page', '1')) || 1)
    const limit = Math.min(100, Math.max(1, Number.parseInt(request.input('limit', '20')) || 20))
    const estado = request.input('estado', '')

    const alertas = await AlertaEmergencia.query()
      .where(this.ciudadDeEmergencia(ciudad))
      .if(estado, (q) => q.whereIn('estado', String(estado).split(',')))
      .preload('usuario', (q) => q.select('id', 'nombre', 'apellido', 'telefono'))
      .preload('viaje', (vq) =>
        vq
          .select(
            'id',
            'estado',
            'origen_direccion',
            'destino_direccion',
            'cliente_id',
            ...COLUMNAS_VIAJE_MAPA_SOS
          )
          .preload('cliente', (cq) => cq.select('id', 'nombre', 'apellido', 'telefono'))
          .preload('conductor', (cq) => cq.select(...COLUMNAS_CONDUCTOR_MAPA_SOS))
      )
      .preload('moderadorAtendio', (q) => q.select('id', 'nombre', 'apellido'))
      .preload('moderadorResolvio', (q) => q.select('id', 'nombre', 'apellido'))
      .orderBy('created_at', 'desc')
      .paginate(page, limit)

    return serialize.withoutWrapping(
      alertas.all().map((a) => {
        const mapa = datosMapaSos(a)
        return {
          id: a.id,
          estado: a.estado,
          estadoLabel: getAlertaEstadoLabel(a.estado),
          viajeId: a.viajeId,
          lat: a.lat !== null ? Number(a.lat) : null,
          lng: a.lng !== null ? Number(a.lng) : null,
          motivo: a.motivo,
          usuario: a.usuario
            ? {
                nombre: `${a.usuario.nombre || ''} ${a.usuario.apellido || ''}`.trim(),
                telefono: a.usuario.telefono,
              }
            : null,
          viaje: a.viaje
            ? {
                id: a.viaje.id,
                estado: a.viaje.estado,
                estadoLabel: getTripEstadoLabel(a.viaje.estado),
                origenDireccion: a.viaje.origenDireccion,
                destinoDireccion: a.viaje.destinoDireccion,
                origen: a.viaje.origenDireccion,
                destino: a.viaje.destinoDireccion,
                origenCoords: mapa.origenCoords,
                destinoCoords: mapa.destinoCoords,
                cliente: a.viaje.cliente
                  ? {
                      nombre: `${a.viaje.cliente.nombre || ''} ${a.viaje.cliente.apellido || ''}`.trim(),
                      telefono: a.viaje.cliente.telefono,
                    }
                  : null,
              }
            : null,
          conductorUbicacion: mapa.conductorUbicacion,
          sos: mapa.sos,
          observacion: a.observacion,
          administrador: a.moderadorAtendio
            ? `${a.moderadorAtendio.nombre || ''} ${a.moderadorAtendio.apellido || ''}`.trim()
            : null,
          atendidaAt: a.atendidaAt?.toISO() ?? null,
          resueltaAt: a.resueltaAt?.toISO() ?? null,
          resueltoPor: a.moderadorResolvio
            ? `${a.moderadorResolvio.nombre || ''} ${a.moderadorResolvio.apellido || ''}`.trim()
            : null,
          createdAt: a.createdAt.toISO(),
        }
      })
    )
  }

  async emergencyAcknowledge({ auth, params, response, serialize }: HttpContext) {
    const user = auth.getUserOrFail()
    const alerta = await AlertaEmergencia.find(params.id)
    if (!alerta) {
      return response
        .status(404)
        .send(await serialize.withoutWrapping({ error: 'Alerta de emergencia no encontrada' }))
    }

    if (alerta.estado === 'resuelta') {
      return response
        .status(409)
        .send(await serialize.withoutWrapping({ error: 'La alerta ya fue resuelta' }))
    }

    const zona = await resolverZonaAlerta(alerta.viajeId, numeroLatLng(alerta.lat), numeroLatLng(alerta.lng))
    if (zona && user.zonaModerador && zona !== user.zonaModerador) {
      return response
        .status(403)
        .send(await serialize.withoutWrapping({ error: 'La emergencia pertenece a otra ciudad' }))
    }

    if (alerta.estado === 'pendiente') {
      alerta.estado = 'atendida'
      alerta.atendida = true
      alerta.moderadorAtendioId = user.id
      alerta.atendidaAt = DateTime.now()
    }
    await alerta.save()

    emitToModerators(user.zonaModerador || zona || '', 'moderator:emergency:update', {
      id: alerta.id,
      estado: alerta.estado,
      estadoLabel: getAlertaEstadoLabel(alerta.estado),
      atendidoPor: `${user.nombre} ${user.apellido}`.trim(),
      atendidaAt: alerta.atendidaAt?.toISO() ?? null,
    })

    return serialize.withoutWrapping({
      id: alerta.id,
      estado: alerta.estado,
      estadoLabel: getAlertaEstadoLabel(alerta.estado),
      atendidoPor: `${user.nombre} ${user.apellido}`.trim(),
      atendidaAt: alerta.atendidaAt?.toISO() ?? null,
    })
  }

  async emergencyResolve({ auth, params, request, response, serialize }: HttpContext) {
    const user = auth.getUserOrFail()
    const alerta = await AlertaEmergencia.find(params.id)
    if (!alerta) {
      return response
        .status(404)
        .send(await serialize.withoutWrapping({ error: 'Alerta de emergencia no encontrada' }))
    }

    if (alerta.estado === 'resuelta') {
      return response
        .status(409)
        .send(await serialize.withoutWrapping({ error: 'La alerta ya fue resuelta' }))
    }

    const zona = await resolverZonaAlerta(alerta.viajeId, numeroLatLng(alerta.lat), numeroLatLng(alerta.lng))
    if (zona && user.zonaModerador && zona !== user.zonaModerador) {
      return response
        .status(403)
        .send(await serialize.withoutWrapping({ error: 'La emergencia pertenece a otra ciudad' }))
    }

    alerta.estado = 'resuelta'
    alerta.atendida = true
    alerta.moderadorResolvioId = user.id
    alerta.resueltaAt = DateTime.now()
    const observacion = request.input('observacion', null)
    if (observacion && String(observacion).trim()) {
      alerta.observacion = String(observacion).trim()
    }
    if (!alerta.moderadorAtendioId) {
      alerta.moderadorAtendioId = user.id
      alerta.atendidaAt = DateTime.now()
    }
    await alerta.save()

    await alerta.load('usuario', (q) => q.select('id', 'nombre', 'apellido', 'telefono', 'email'))
    await alerta.load('viaje', (vq) =>
      vq
        .select('id', 'estado', 'origen_direccion', 'destino_direccion', 'cliente_id', 'precio_final', 'carga', ...COLUMNAS_VIAJE_MAPA_SOS)
        .preload('cliente', (cq) => cq.select('id', 'nombre', 'apellido', 'telefono', 'email'))
        .preload('conductor', (cq2) =>
          cq2.select('placa', 'tipo_vehiculo', 'ciudad', ...COLUMNAS_CONDUCTOR_MAPA_SOS).preload('usuario', (uq) => uq.select('id', 'nombre', 'apellido', 'telefono'))
        )
    )
    await alerta.load('moderadorAtendio', (q) => q.select('id', 'nombre', 'apellido', 'email'))
    await alerta.load('moderadorResolvio', (q) => q.select('id', 'nombre', 'apellido', 'email'))

    const mapa = datosMapaSos(alerta)
    const caso = {
      id: alerta.id,
      estado: alerta.estado,
      estadoLabel: getAlertaEstadoLabel(alerta.estado),
      motivo: alerta.motivo,
      lat: alerta.lat !== null ? Number(alerta.lat) : null,
      lng: alerta.lng !== null ? Number(alerta.lng) : null,
      observacion: alerta.observacion,
      usuario: alerta.usuario
        ? {
            nombre: `${alerta.usuario.nombre || ''} ${alerta.usuario.apellido || ''}`.trim(),
            telefono: alerta.usuario.telefono,
            email: alerta.usuario.email,
            rol: alerta.usuario.rol,
          }
        : null,
      viaje: alerta.viaje
        ? {
            id: alerta.viaje.id,
            estado: alerta.viaje.estado,
            estadoLabel: getTripEstadoLabel(alerta.viaje.estado),
            origenDireccion: alerta.viaje.origenDireccion,
            destinoDireccion: alerta.viaje.destinoDireccion,
            origen: alerta.viaje.origenDireccion,
            destino: alerta.viaje.destinoDireccion,
            origenCoords: mapa.origenCoords,
            destinoCoords: mapa.destinoCoords,
            carga: alerta.viaje.carga,
            precioFinal: alerta.viaje.precioFinal !== null ? Number(alerta.viaje.precioFinal) : null,
            cliente: alerta.viaje.cliente
              ? {
                  nombre: `${alerta.viaje.cliente.nombre || ''} ${alerta.viaje.cliente.apellido || ''}`.trim(),
                  telefono: alerta.viaje.cliente.telefono,
                  email: alerta.viaje.cliente.email,
                }
              : null,
            conductor: alerta.viaje.conductor
              ? {
                  nombre: `${alerta.viaje.conductor.usuario?.nombre || ''} ${alerta.viaje.conductor.usuario?.apellido || ''}`.trim(),
                  telefono: alerta.viaje.conductor.usuario?.telefono,
                  placa: alerta.viaje.conductor.placa,
                  tipoVehiculo: alerta.viaje.conductor.tipoVehiculo,
                  ciudad: alerta.viaje.conductor.ciudad,
                }
              : null,
          }
        : null,
      conductorUbicacion: mapa.conductorUbicacion,
      sos: mapa.sos,
      atendidoPor: alerta.moderadorAtendio
        ? `${alerta.moderadorAtendio.nombre || ''} ${alerta.moderadorAtendio.apellido || ''}`.trim()
        : null,
      atendidoEmail: alerta.moderadorAtendio?.email ?? null,
      atendidaAt: alerta.atendidaAt?.toISO() ?? null,
      resueltoPor: alerta.moderadorResolvio
        ? `${alerta.moderadorResolvio.nombre || ''} ${alerta.moderadorResolvio.apellido || ''}`.trim()
        : null,
      resueltoEmail: alerta.moderadorResolvio?.email ?? null,
      resueltaAt: alerta.resueltaAt?.toISO() ?? null,
      createdAt: alerta.createdAt?.toISO() ?? null,
    }

    emitToModerators(user.zonaModerador || zona || '', 'moderator:emergency:update', {
      id: alerta.id,
      estado: alerta.estado,
      estadoLabel: getAlertaEstadoLabel(alerta.estado),
      resueltoPor: `${user.nombre} ${user.apellido}`.trim(),
      resueltaAt: alerta.resueltaAt?.toISO() ?? null,
      observacion: alerta.observacion,
    })

    emitToAdmin('emergency:case_closed', caso)

    return serialize.withoutWrapping({
      id: alerta.id,
      estado: alerta.estado,
      estadoLabel: getAlertaEstadoLabel(alerta.estado),
      atendidoPor: alerta.moderadorAtendioId
        ? `${user.nombre} ${user.apellido}`.trim()
        : null,
      atendidaAt: alerta.atendidaAt?.toISO() ?? null,
      resueltoPor: `${user.nombre} ${user.apellido}`.trim(),
      resueltaAt: alerta.resueltaAt?.toISO() ?? null,
      observacion: alerta.observacion,
    })
  }
}

function numeroLatLng(val: unknown): number | null {
  return typeof val === 'string' && val.trim() !== '' ? Number(val) : (val as number | null)
}
