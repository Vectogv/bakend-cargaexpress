import User from '#models/user'
import Conductor, { DOCUMENTOS_REQUERIDOS, errorFaltantes } from '#models/conductor'
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
import Reporte from '#models/reporte'
import LogFraude from '#models/log_fraude'
import { notifyDriverValidator } from '#validators/driver'
import type { HttpContext } from '@adonisjs/core/http'
import { DateTime } from 'luxon'
import logger from '@adonisjs/core/services/logger'
import db from '@adonisjs/lucid/services/db'
import { sendToMultiple, sendToToken } from '#services/push_notification_service'
import { notificarConductor } from '#services/notificar_conductor'
import { diasInactividad, payloadRecorrido, ubicacionSiConectado } from '#services/viaje_recorrido_service'
import TripFinalizationService from '#services/trip_finalization_service'
import ReferidosService from '#services/referidos_service'
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
import { restaurarViajeTrasSos } from '#services/sos_trip_service'
import antifraudeConfig from '#config/antifraude'
import {
  conductoresDeZona,
  casosPorViaje,
  casoVacio,
  hayCaso,
  nombreCorto,
  filtroAlertasDeZona,
} from '#services/moderador_acceso_cliente'

/** Estados que el panel del moderador cuenta como "viaje activo". */
const ESTADOS_VIAJE_ACTIVO_PANEL = [
  'sos',
  'pendiente_confirmacion',
  'en_curso',
  'entregado',
  'esperando_confirmacion',
  'conductor_llegada',
  'conductor_en_camino',
  'aceptado',
]

const ESTADO_REPORTE_LABEL: Record<string, string> = { pendiente: 'Pendiente', resuelto: 'Resuelto' }

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

  async driversList({ auth, request, response, serialize }: HttpContext) {
    const user = auth.getUserOrFail()
    const esAdmin = user.rol === 'admin'
    if (!esAdmin && !user.zonaModerador) {
      return response
        .status(403)
        .send(await serialize.withoutWrapping({ message: 'No tienes una zona asignada' }))
    }
    const page = Math.max(1, Number.parseInt(request.input('page', '1')) || 1)
    const limit = Math.min(100, Math.max(1, Number.parseInt(request.input('limit', '20')) || 20))
    const estado = request.input('estado') || null
    const buscar = String(request.input('buscar') || '').trim()
    // ?online=1: solo conectados (mapa en vivo de la zona).
    const soloOnline = ['1', 'true'].includes(String(request.input('online') || ''))
    const ciudad = esAdmin ? request.input('ciudad') || null : user.zonaModerador
    // La ciudad del conductor se guarda sin normalizar (puede traer tildes o
    // mayúsculas distintas a la zona del moderador): se compara con claveDe en
    // memoria en vez de en SQL. ponytail: trae todos los conductores que matchean
    // estado antes de filtrar; a la escala de un piloto (una ciudad) es aceptable,
    // si crece conviene una columna normalizada + índice.
    const claveEsperada = ciudad ? claveDe(ciudad) : null

    const candidatos = await Conductor.query()
      .if(estado, (q) => q.where('estado_verificacion', estado!))
      .if(soloOnline, (q) => q.where('online', true))
      .preload('usuario', (q) => q.select('id', 'nombre', 'apellido', 'telefono', 'email', 'avatar', 'estado_cuenta'))
      .orderBy('created_at', 'desc')

    const filtrados = candidatos
      .filter((c) => !claveEsperada || claveDe(c.ciudad || '') === claveEsperada)
      .filter((c) => !buscar || coincideConductor(c, buscar))
    const inicio = (page - 1) * limit
    const pagina = filtrados.slice(inicio, inicio + limit)

    return serialize.withoutWrapping({ data: pagina.map(resumenConductor), total: filtrados.length, page, limit })
  }

  /** Ficha completa de un conductor de la zona (perfil, vehículo, documentos, viajes, reportes). */
  async driverShow({ auth, params, request, response, serialize }: HttpContext) {
    const user = auth.getUserOrFail()
    const zona = zonaDeConsulta(user, request.input('ciudad'))
    if (zona === false) {
      return response
        .status(403)
        .send(await serialize.withoutWrapping({ message: 'No tienes una zona asignada' }))
    }
    const c = await Conductor.query().where('id', params.id).preload('usuario').first()
    if (!c) {
      return response.status(404).send(await serialize.withoutWrapping({ message: 'Conductor no encontrado' }))
    }
    if (zona && claveDe(c.ciudad || '') !== zona) {
      return response
        .status(403)
        .send(await serialize.withoutWrapping({ message: 'Este conductor no pertenece a tu zona' }))
    }

    const [viajes, reportesClientes, reportesModerador, disputas] = await Promise.all([
      Viaje.query()
        .where('conductor_id', c.id)
        .preload('cliente', (q) => q.select('id', 'nombre', 'apellido'))
        .orderBy('created_at', 'desc')
        .limit(10),
      Reporte.query().where('conductor_id', c.id).where('reportado_por', 'cliente').orderBy('created_at', 'desc').limit(20),
      ReporteModerador.query()
        .where('conductor_id', c.id)
        .preload('moderador', (q) => q.select('id', 'nombre', 'apellido'))
        .orderBy('created_at', 'desc')
        .limit(20),
      Disputa.query().where('conductor_id', c.id).orderBy('created_at', 'desc').limit(20),
    ])
    const u = c.usuario

    return serialize.withoutWrapping({
      ...resumenConductor(c),
      penalizacionCancelacion: Number(c.penalizacionCancelacion || 0),
      usuario: u
        ? {
            id: u.id,
            nombre: `${u.nombre || ''} ${u.apellido || ''}`.trim(),
            telefono: u.telefono,
            email: u.email,
            avatar: u.avatar,
            edad: u.edad,
            cedula: u.cedula,
            contactoEmergenciaNombre: u.contactoEmergenciaNombre,
            contactoEmergenciaTelefono: u.contactoEmergenciaTelefono,
            calificacion: u.calificacion,
            estadoCuenta: u.estadoCuenta,
            suspendido: u.suspendido,
            tieneDeudaActiva: u.tieneDeudaActiva,
            montoDeuda: u.montoDeuda !== null ? Number(u.montoDeuda) : null,
            createdAt: u.createdAt?.toISO() ?? null,
          }
        : null,
      documentos: {
        fotoCedula: SignedUploadService.sign(c.fotoCedula),
        fotoLicencia: SignedUploadService.sign(c.fotoLicencia),
        ...c.documentosExtra((p) => SignedUploadService.sign(p)),
      },
      viajes: viajes.map((t) => ({
        id: t.id,
        estado: t.estado,
        estadoLabel: getTripEstadoLabel(t.estado),
        origenDireccion: t.origenDireccion,
        destinoDireccion: t.destinoDireccion,
        precioFinal: t.precioFinal !== null ? Number(t.precioFinal) : null,
        cliente: t.cliente ? { id: t.cliente.id, nombre: nombreCorto(t.cliente) } : null,
        createdAt: t.createdAt.toISO(),
      })),
      reportes: reportesClientes.map((r) => ({
        id: r.id,
        viajeId: r.viajeId,
        motivo: r.motivo,
        descripcion: r.descripcion,
        estado: r.estado,
        createdAt: r.createdAt.toISO(),
      })),
      reportesModerador: reportesModerador.map((r) => ({
        id: r.id,
        descripcion: r.descripcion,
        estado: r.estado,
        moderador: r.moderador ? `${r.moderador.nombre || ''} ${r.moderador.apellido || ''}`.trim() : null,
        createdAt: r.createdAt.toISO(),
      })),
      disputas: disputas.map((d) => ({
        id: d.id,
        viajeId: d.viajeId,
        estado: d.estado,
        resultado: d.resultado,
        createdAt: d.createdAt.toISO(),
      })),
    })
  }

  async inactiveDrivers({ auth, request, response, serialize }: HttpContext) {
    const user = auth.getUserOrFail()
    const esAdmin = user.rol === 'admin'
    if (!esAdmin && !user.zonaModerador) {
      return response
        .status(403)
        .send(await serialize.withoutWrapping({ message: 'No tienes una zona asignada' }))
    }
    const ciudad = esAdmin ? request.input('ciudad') || null : user.zonaModerador
    const claveEsperada = ciudad ? claveDe(ciudad) : null
    const dias = await diasInactividad()
    const fechaLimite = DateTime.now().minus({ days: dias }).toSQL()
    const page = Math.max(1, Number.parseInt(request.input('page', '1')) || 1)
    const limit = Math.min(100, Math.max(1, Number.parseInt(request.input('limit', '20')) || 20))

    // Solo aprobados con más de `dias` (configuración) de registro: un pendiente o
    // un recién registrado no es "inactivo", todavía no ha podido trabajar.
    const candidatos = await Conductor.query()
      .select('conductores.*')
      .select(
        db.from('viajes').max('created_at').whereRaw('viajes.conductor_id = conductores.id').as('ultimo_viaje_at')
      )
      .where('estado_verificacion', 'aprobado')
      .where('conductores.created_at', '<', fechaLimite)
      .whereNotExists((qb) => {
        qb.from('viajes')
          .whereRaw('viajes.conductor_id = conductores.id')
          .where('viajes.created_at', '>=', fechaLimite)
      })
      .where('online', false)
      .preload('usuario', (q) => q.select('id', 'nombre', 'apellido', 'telefono', 'email', 'avatar', 'estado_cuenta'))
      .orderBy('conductores.created_at', 'desc')

    const filtrados = claveEsperada
      ? candidatos.filter((c) => claveDe(c.ciudad || '') === claveEsperada)
      : candidatos
    const inicio = (page - 1) * limit
    const pagina = filtrados.slice(inicio, inicio + limit)

    return serialize.withoutWrapping({
      data: pagina.map((c) => ({
        ...resumenConductor(c),
        ultimoViajeAt: fechaSql(c.$extras.ultimo_viaje_at),
      })),
      total: filtrados.length,
      page,
      limit,
      inactividadDias: dias,
    })
  }

  async notifyDriver({ auth, params, request, response, serialize }: HttpContext) {
    const user = auth.getUserOrFail()
    const { documentos, mensaje } = await request.validateUsing(notifyDriverValidator)
    const conductor = await Conductor.find(params.id)
    if (!conductor) {
      return response
        .status(404)
        .send(await serialize.withoutWrapping({ error: 'Conductor no encontrado' }))
    }

    if (user.rol !== 'admin') {
      if (!user.zonaModerador) {
        return response
          .status(403)
          .send(await serialize.withoutWrapping({ message: 'No tienes una zona asignada' }))
      }
      if (claveDe(conductor.ciudad || '') !== claveDe(user.zonaModerador)) {
        return response
          .status(403)
          .send(await serialize.withoutWrapping({ error: 'Este conductor no pertenece a tu ciudad' }))
      }
    }

    // Un solo camino para avisar a un conductor: bandeja + push + correo (notificar_conductor).
    // Con `documentos`: aviso de documentos faltantes; sin ellos: recordatorio de inactividad.
    const nota = mensaje ? `\nNota del moderador: ${mensaje}` : ''
    const aviso = documentos?.length
      ? {
          tipo: 'documentos_faltantes',
          titulo: 'Faltan documentos',
          cuerpo:
            `Te falta subir: ${documentos.map((d) => DOCUMENTOS_REQUERIDOS[d]).join(', ')}. ` +
            `Los demás documentos están en revisión. Súbelos desde Perfil → Documentos.` +
            nota,
        }
      : {
          tipo: 'recordatorio_actividad',
          titulo: 'Recordatorio CargaExpress',
          cuerpo: 'Hemos notado que no has realizado viajes recientemente. ¡Los clientes te esperan!' + nota,
        }
    const canales = await notificarConductor(conductor.usuarioId, aviso)

    return serialize.withoutWrapping({
      success: true,
      conductorId: conductor.id,
      ...(documentos?.length ? { documentos } : {}),
      push: canales.push,
      canales,
    })
  }

  async reportDriver({ auth, params, request, response, serialize }: HttpContext) {
    const user = auth.getUserOrFail()
    const conductor = await Conductor.find(params.id)
    if (!conductor) {
      return response
        .status(404)
        .send(await serialize.withoutWrapping({ error: 'Conductor no encontrado' }))
    }

    if (user.rol !== 'admin') {
      if (!user.zonaModerador) {
        return response
          .status(403)
          .send(await serialize.withoutWrapping({ message: 'No tienes una zona asignada' }))
      }
      if (claveDe(conductor.ciudad || '') !== claveDe(user.zonaModerador)) {
        return response
          .status(403)
          .send(await serialize.withoutWrapping({ error: 'Este conductor no pertenece a tu ciudad' }))
      }
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
    if (!esAdmin) {
      if (!user.zonaModerador) {
        return response
          .status(403)
          .send(await serialize.withoutWrapping({ message: 'No tienes una zona asignada' }))
      }
      if (claveDe(conductor.ciudad || '') !== claveDe(user.zonaModerador)) {
        return response
          .status(403)
          .send(await serialize.withoutWrapping({ error: 'No puedes verificar conductores de otra ciudad' }))
      }
    }

    // Misma regla que el admin: solo al aprobar, no afecta a los ya aprobados.
    const faltantes = conductor.documentosFaltantes()
    if (faltantes.length) {
      return response.status(422).send(await serialize.withoutWrapping(errorFaltantes(faltantes)))
    }

    conductor.estadoVerificacion = 'aprobado'
    conductor.notaRechazo = null
    await conductor.save()
    await ReferidosService.alAprobar(conductor.id)

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
    if (!esAdmin) {
      if (!user.zonaModerador) {
        return response
          .status(403)
          .send(await serialize.withoutWrapping({ message: 'No tienes una zona asignada' }))
      }
      if (claveDe(conductor.ciudad || '') !== claveDe(user.zonaModerador)) {
        return response
          .status(403)
          .send(await serialize.withoutWrapping({ error: 'No puedes verificar conductores de otra ciudad' }))
      }
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
    const zonaEncuesta = claveDe(encuesta.zona || '')
    const zonaUsuario = claveDe(user.zonaModerador || '')
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

  /**
   * Zonas de avisos visibles para el usuario: la suya (normalizada) más las
   * generales. Admin: todas, o ?ciudad + generales. Moderador: su zona.
   * Conductor: la de su ciudad. Resto (clientes): solo generales.
   * `''` cuenta como general (avisos antiguos sin zona).
   */
  private async zonasDeAvisos(user: User, ciudadQuery: unknown): Promise<string[] | null> {
    const generales = ['general', '']
    if (user.rol === 'admin') {
      const clave = claveDe(String(ciudadQuery ?? ''))
      return clave && clave !== 'general' ? [clave, ...generales] : null
    }
    if (user.esModerador && user.zonaModerador) {
      return [claveDe(user.zonaModerador), ...generales]
    }
    const conductor = await Conductor.query().where('usuario_id', user.id).select('id', 'ciudad').first()
    const clave = conductor?.ciudad ? claveDe(conductor.ciudad) : ''
    return clave ? [clave, ...generales] : generales
  }

  /**
   * Un moderador (no admin) solo fija/elimina avisos de su zona. Los avisos
   * que publican los conductores quedan en 'general'; esos los puede moderar
   * el moderador de la ciudad del conductor autor.
   */
  private async puedeModerarAviso(user: User, aviso: Aviso): Promise<boolean> {
    if (user.rol === 'admin') return true
    const zona = claveDe(user.zonaModerador || '')
    if (!zona) return false
    if (claveDe(aviso.zona || '') === zona) return true
    const conductorAutor = await Conductor.query().where('usuario_id', aviso.autorId).select('id', 'ciudad').first()
    return (
      ['general', ''].includes(aviso.zona || '') &&
      !!conductorAutor?.ciudad &&
      claveDe(conductorAutor.ciudad) === zona
    )
  }

  async avisosIndex({ auth, request, serialize }: HttpContext) {
    const user = auth.getUserOrFail()
    const page = Math.max(1, Number.parseInt(request.input('page', '1')) || 1)
    const limit = Math.min(100, Math.max(1, Number.parseInt(request.input('limit', '20')) || 20))
    const zonas = await this.zonasDeAvisos(user, request.input('ciudad'))
    const mensajes = await Aviso.query()
      .where('eliminado', false)
      .if(zonas, (q) => q.whereIn('zona', zonas!))
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
        .send(await serialize.withoutWrapping({ error: 'No tienes permiso para publicar avisos' }))
    }

    const { contenido } = request.only(['contenido'])
    if (!contenido || typeof contenido !== 'string' || contenido.trim().length === 0) {
      return response
        .status(422)
        .send(await serialize.withoutWrapping({ error: 'El contenido no puede estar vacío' }))
    }

    // Moderador: siempre su zona. Admin: ?ciudad (normalizada) o general.
    // Conductor: general, como antes.
    let zona = 'general'
    if (user.rol === 'admin') {
      zona = claveDe(String(request.input('ciudad') ?? '')) || 'general'
    } else if (user.esModerador && user.zonaModerador) {
      zona = claveDe(user.zonaModerador)
    }

    const msg = await Aviso.create({
      autorId: user.id,
      zona,
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
    if (!(await this.puedeModerarAviso(user, msg))) {
      return response
        .status(403)
        .send(await serialize.withoutWrapping({ error: 'El aviso pertenece a otra zona' }))
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
    if (!(await this.puedeModerarAviso(user, msg))) {
      return response
        .status(403)
        .send(await serialize.withoutWrapping({ error: 'El aviso pertenece a otra zona' }))
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
      .preload('conductor', (q) =>
        q.select('id', 'usuario_id', 'placa').preload('usuario', (uq) => uq.select('id', 'nombre', 'apellido'))
      )
      .orderBy('created_at', 'desc')
      .paginate(page, limit)

    return serialize.withoutWrapping(
      reportes.all().map((r) => ({
        id: r.id,
        conductorId: r.conductorId,
        conductorNombre: `${r.conductor?.usuario?.nombre || ''} ${r.conductor?.usuario?.apellido || ''}`.trim() || null,
        placa: r.conductor?.placa ?? null,
        descripcion: r.descripcion,
        estado: r.estado,
        estadoLabel: ESTADO_REPORTE_LABEL[r.estado] ?? r.estado,
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
    const fechaLimite = DateTime.now().minus({ days: await diasInactividad() }).toSQL()
    // `conductores.ciudad` es texto libre: se compara normalizado (claveDe).
    const clave = ciudad ? claveDe(ciudad) : null
    const deZona = clave ? await conductoresDeZona(clave) : null
    const conductorIds = deZona ? deZona.conductorIds : null

    const [
      totalDrivers,
      inactiveDrivers,
      onlineDrivers,
      totalComunicados,
      totalAvisos,
      totalReports,
      pendientesVerificacion,
      viajesActivos,
      enCurso,
      emergenciasActivas,
      emergenciasPendientes,
      comunicadosPendientes,
    ] = await Promise.all([
        Conductor.query().if(conductorIds, (q) => q.whereIn('id', conductorIds!)).count('* as total').first(),
        Conductor.query()
          .if(conductorIds, (q) => q.whereIn('id', conductorIds!))
          .where('online', false)
          .whereNotExists((q) => {
            q.from('viajes')
              .whereRaw('viajes.conductor_id = conductores.id')
              .where('viajes.created_at', '>=', fechaLimite)
          })
          .count('* as total')
          .first(),
        Conductor.query()
          .if(conductorIds, (q) => q.whereIn('id', conductorIds!))
          .where('online', true)
          .count('* as total')
          .first(),
        Comunicado.query().where('moderador_id', user.id).count('* as total').first(),
        Aviso.query().where('zona', clave || 'general').count('* as total').first(),
        ReporteModerador.query().where('moderador_id', user.id).count('* as total').first(),
        Conductor.query()
          .if(conductorIds, (q) => q.whereIn('id', conductorIds!))
          .where('estado_verificacion', 'pendiente')
          .count('* as total')
          .first(),
        Viaje.query()
          .whereNotNull('conductor_id')
          .if(conductorIds, (q) => q.whereIn('conductor_id', conductorIds!))
          .whereIn('estado', ESTADOS_VIAJE_ACTIVO_PANEL)
          .count('* as total')
          .first(),
        Viaje.query()
          .whereNotNull('conductor_id')
          .if(conductorIds, (q) => q.whereIn('conductor_id', conductorIds!))
          .where('estado', 'en_curso')
          .count('* as total')
          .first(),
        AlertaEmergencia.query()
          .if(deZona, (q) => q.where(this.ciudadDeEmergencia(deZona!)))
          .whereIn('estado', ['pendiente', 'atendida'])
          .count('* as total')
          .first(),
        AlertaEmergencia.query()
          .if(deZona, (q) => q.where(this.ciudadDeEmergencia(deZona!)))
          .where('estado', 'pendiente')
          .count('* as total')
          .first(),
        Comunicado.query().where('moderador_id', user.id).where('estado', 'pendiente').count('* as total').first(),
      ])

    const n = (fila: { $extras?: { total?: unknown } } | null) => Number(fila?.$extras?.total || 0)
    return serialize.withoutWrapping({
      ciudad: ciudad || null,
      totalDrivers: n(totalDrivers),
      inactiveDrivers: n(inactiveDrivers),
      onlineDrivers: n(onlineDrivers),
      totalComunicados: n(totalComunicados),
      totalAvisos: n(totalAvisos),
      totalReports: n(totalReports),
      // Conteos que antes la web calculaba pidiendo 6 listas.
      pendientesVerificacion: n(pendientesVerificacion),
      viajesActivos: n(viajesActivos),
      enCurso: n(enCurso),
      emergenciasActivas: n(emergenciasActivas),
      emergenciasPendientes: n(emergenciasPendientes),
      comunicadosPendientes: n(comunicadosPendientes),
    })
  }

  async trips({ auth, request, serialize, response }: HttpContext) {
    const user = auth.getUserOrFail()
    const zona = zonaDeConsulta(user, request.input('ciudad'))
    if (zona === false) {
      return response
        .status(403)
        .send(await serialize.withoutWrapping({ error: 'No tienes ciudad asignada' }))
    }
    const conductorIds = zona ? (await conductoresDeZona(zona)).conductorIds : null

    const page = Math.max(1, Number.parseInt(request.input('page', '1')) || 1)
    const limit = Math.min(100, Math.max(1, Number.parseInt(request.input('limit', '20')) || 20))
    const estado = request.input('estado', '')
    const tipoProgramacion = request.input('tipoProgramacion', '')

    const resultado = await Viaje.query()
      .whereNotNull('conductor_id')
      .if(conductorIds, (q) => q.whereIn('conductor_id', conductorIds!))
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

    // El moderador solo ve el contacto del cliente cuando el viaje tiene un caso
    // (SOS, disputa o ticket); si no, apenas el nombre corto. El admin lo ve siempre.
    const esAdmin = user.rol === 'admin'
    const casos = await casosPorViaje(resultado.all().map((t) => Number(t.id)))

    return serialize.withoutWrapping(
      resultado.all().map((t) => {
        const caso = casos.get(Number(t.id)) ?? casoVacio
        const contactoVisible = esAdmin || hayCaso(caso)
        return {
        id: t.id,
        clienteId: t.clienteId,
        conductorId: t.conductorId,
        estado: t.estado,
        estadoLabel: getTripEstadoLabel(t.estado),
        tieneSos: caso.tieneSos,
        tieneDisputa: Boolean(caso.disputa),
        disputaId: caso.disputa?.id ?? null,
        tieneTicket: caso.tickets.length > 0,
        contactoVisible,
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
          ? contactoVisible
            ? {
                id: t.cliente.id,
                nombre: `${t.cliente.nombre || ''} ${t.cliente.apellido || ''}`.trim(),
                telefono: t.cliente.telefono,
                email: t.cliente.email,
              }
            : { id: t.cliente.id, nombre: nombreCorto(t.cliente), telefono: null, email: null }
          : null,
        conductor: t.conductor
          ? {
              id: t.conductor.id,
              usuarioId: t.conductor.usuarioId,
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
        }
      })
    )
  }

  /** Disputas de los conductores de la zona (solo lectura: las cierra el admin). */
  async disputes({ auth, request, serialize, response }: HttpContext) {
    const user = auth.getUserOrFail()
    const zona = zonaDeConsulta(user, request.input('ciudad'))
    if (zona === false) {
      return response
        .status(403)
        .send(await serialize.withoutWrapping({ error: 'No tienes ciudad asignada' }))
    }
    const conductorIds = zona ? (await conductoresDeZona(zona)).conductorIds : null
    const page = Math.max(1, Number.parseInt(request.input('page', '1')) || 1)
    const limit = Math.min(100, Math.max(1, Number.parseInt(request.input('limit', '20')) || 20))
    const estado = String(request.input('estado', '') || '')

    const resultado = await Disputa.query()
      .if(conductorIds, (q) => q.whereIn('conductor_id', conductorIds!))
      .if(estado, (q) => q.whereIn('estado', estado.split(',')))
      .preload('viaje', (q) => q.select('id', 'estado', 'origen_direccion', 'destino_direccion', 'precio_final'))
      .preload('conductor', (q) =>
        q.select('id', 'usuario_id', 'placa').preload('usuario', (uq) => uq.select('id', 'nombre', 'apellido'))
      )
      .preload('cliente', (q) => q.select('id', 'nombre', 'apellido', 'telefono'))
      .orderBy('created_at', 'desc')
      .paginate(page, limit)

    return serialize.withoutWrapping({
      total: resultado.total,
      page: resultado.currentPage,
      data: resultado.all().map((d) => ({
        id: d.id,
        viajeId: d.viajeId,
        conductorId: d.conductorId,
        clienteId: d.clienteId,
        numero: d.numero,
        problema: d.problema,
        descripcion: d.descripcion,
        versionConductor: d.versionConductor,
        versionCliente: d.versionCliente,
        soporteCliente: SignedUploadService.sign(d.soporteCliente),
        fotos: SignedUploadService.sign(Array.isArray(d.fotos) ? d.fotos : []),
        estado: d.estado,
        resultado: d.resultado,
        reembolso: d.reembolso !== null ? Number(d.reembolso) : null,
        comentarioAdmin: d.comentarioAdmin,
        viaje: d.viaje
          ? {
              id: d.viaje.id,
              estado: d.viaje.estado,
              origen: d.viaje.origenDireccion,
              destino: d.viaje.destinoDireccion,
              montoFinal: d.viaje.precioFinal !== null ? Number(d.viaje.precioFinal) : null,
            }
          : null,
        conductor: d.conductor
          ? {
              id: d.conductor.id,
              usuarioId: d.conductor.usuarioId,
              nombre: `${d.conductor.usuario?.nombre || ''} ${d.conductor.usuario?.apellido || ''}`.trim(),
              placa: d.conductor.placa,
            }
          : null,
        // La disputa ya relaciona al cliente con la zona: el contacto sí se muestra.
        cliente: d.cliente
          ? {
              id: d.cliente.id,
              nombre: `${d.cliente.nombre || ''} ${d.cliente.apellido || ''}`.trim(),
              telefono: d.cliente.telefono,
            }
          : null,
        createdAt: d.createdAt.toISO(),
        resueltaAt: d.resueltaAt?.toISO() ?? null,
      })),
    })
  }

  async tripShow({ auth, params, request, serialize, response }: HttpContext) {
    const user = auth.getUserOrFail()
    const zona = zonaDeConsulta(user, request.input('ciudad'))
    if (zona === false) {
      return response
        .status(403)
        .send(await serialize.withoutWrapping({ error: 'No tienes ciudad asignada' }))
    }
    const conductorIds = zona ? (await conductoresDeZona(zona)).conductorIds : null

    const viaje = await Viaje.query()
      .where('id', params.id)
      .if(conductorIds, (q) => q.whereIn('conductor_id', conductorIds!))
      .preload('cliente', (q) => q.select('id', 'nombre', 'apellido', 'telefono', 'email', 'avatar'))
      .preload('conductor', (q) =>
        q
          .select(
            'id',
            'usuario_id',
            'placa',
            'tipo_vehiculo',
            'foto_vehiculo',
            'foto_conductor',
            'ciudad',
            'calificacion',
            'total_viajes',
            'online',
            'ultima_ubicacion_lat',
            'ultima_ubicacion_lng',
            'ubicacion_actualizada_en'
          )
          .preload('usuario', (uq) => uq.select('id', 'nombre', 'apellido', 'telefono', 'email', 'avatar'))
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
    const caso = (await casosPorViaje([Number(viaje.id)])).get(Number(viaje.id)) ?? casoVacio
    const contactoVisible = user.rol === 'admin' || hayCaso(caso)

    return serialize.withoutWrapping({
      id: Number(viaje.id),
      estado: viaje.estado,
      estadoLabel: getTripEstadoLabel(viaje.estado),
      disputa: caso.disputa,
      tickets: caso.tickets,
      contactoVisible,
      cliente: viaje.cliente
        ? contactoVisible
          ? {
              id: viaje.cliente.id,
              nombre: `${viaje.cliente.nombre || ''} ${viaje.cliente.apellido || ''}`.trim(),
              telefono: viaje.cliente.telefono,
              email: viaje.cliente.email,
              avatar: viaje.cliente.avatar,
            }
          : { id: viaje.cliente.id, nombre: nombreCorto(viaje.cliente), telefono: null, email: null, avatar: null }
        : null,
      conductor: viaje.conductor
        ? {
            id: viaje.conductor.id,
            usuarioId: viaje.conductor.usuarioId,
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
            avatar: viaje.conductor.fotoConductor || viaje.conductor.usuario?.avatar || null,
          }
        : null,
      // Solo un conductor conectado y en viaje activo entrega su ubicación.
      conductorUbicacion: ubicacionSiConectado(viaje.conductor, ESTADOS_VIAJE_ACTIVO_PANEL.includes(viaje.estado)),
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
      fotoRecogida: viaje.fotoRecogida,
      receptorNombre: viaje.receptorNombre,
      receptorTelefono: viaje.receptorTelefono,
      tipoVehiculoRequerido: viaje.tipoVehiculoRequerido,
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

  /**
   * Recorrido real del viaje (puntos guardados desde PUT /drivers/location),
   * ruta planeada y último punto con su hora. Moderador: solo viajes de su zona.
   */
  async tripRecorrido({ auth, params, request, serialize, response }: HttpContext) {
    const user = auth.getUserOrFail()
    const zona = zonaDeConsulta(user, request.input('ciudad'))
    if (zona === false) {
      return response
        .status(403)
        .send(await serialize.withoutWrapping({ error: 'No tienes ciudad asignada' }))
    }
    const conductorIds = zona ? (await conductoresDeZona(zona)).conductorIds : null
    const viaje = await Viaje.query()
      .where('id', params.id)
      .if(conductorIds, (q) => q.whereIn('conductor_id', conductorIds!))
      .preload('conductor', (q) =>
        q.select('id', 'online', 'ultima_ubicacion_lat', 'ultima_ubicacion_lng', 'ubicacion_actualizada_en')
      )
      .first()
    if (!viaje) {
      return response
        .status(404)
        .send(await serialize.withoutWrapping({ error: 'Viaje no encontrado en tu ciudad' }))
    }
    return serialize.withoutWrapping(await payloadRecorrido(viaje, viaje.conductor ?? null))
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
        actorRol: user.rol === 'admin' ? 'admin' : 'moderador',
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

        try {
          const usuarios = await User.query().whereIn(
            'id',
            [viajeFinalizado.clienteId, conductor?.usuarioId].filter((x): x is number => !!x)
          )
          for (const u of usuarios) {
            if (u.fcmToken) {
              await sendToToken(
                u.fcmToken,
                'Envío entregado',
                `El viaje #${viajeFinalizado.id} fue cerrado por un moderador.`,
                { tipo: 'viaje_estado', viajeId: String(viajeFinalizado.id) }
              )
            }
          }
        } catch (e) {
          logger.error({ err: e, viajeId }, 'Error enviando push de cierre por moderador')
        }
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

    // Transacción con bloqueo del viaje: dos resoluciones simultáneas (o el
    // cliente confirmando a la vez) no deben dejar dos disputas ni pisar un
    // estado que ya cambió. Si ya hay una disputa abierta del viaje se reusa
    // (como DisputeController, nunca se duplica).
    const resultadoDisputa = await db.transaction(async (trx) => {
      const bloqueado = await Viaje.query({ client: trx }).where('id', viajeId).forUpdate().first()
      if (!bloqueado || bloqueado.estado !== 'pendiente_confirmacion') {
        return {
          error: `El viaje ya no está pendiente de confirmación (estado actual: ${bloqueado?.estado ?? 'desconocido'})`,
        }
      }

      const existente = await Disputa.query({ client: trx }).where('viaje_id', viajeId).first()
      if (existente && existente.estado === 'resuelta') {
        return { error: 'Ya existe una disputa resuelta para este viaje' }
      }
      const nueva =
        existente ??
        (await Disputa.create(
          {
            viajeId: bloqueado.id,
            conductorId: conductor.id,
            clienteId: bloqueado.clienteId,
            estado: 'abierta',
            problema: 'cierre_sin_confirmar',
            descripcion: notaResolucion,
            versionConductor: 'Conductor solicitó cierre del servicio',
            versionCliente: 'Cliente no confirmó el cierre dentro del tiempo límite',
          },
          { client: trx }
        ))

      bloqueado.estado = 'disputa'
      await bloqueado.useTransaction(trx).save()
      return { disputa: nueva }
    })

    if ('error' in resultadoDisputa) {
      return response.status(409).json({ error: resultadoDisputa.error })
    }
    const { disputa } = resultadoDisputa
    // La instancia externa (sin transacción) se sincroniza para los emits.
    viaje.estado = 'disputa'

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

    // La fila de la bandeja la crea sendToToken (tipo viaje_estado, con viajeId).
    const clienteUsuario = await User.find(viaje.clienteId)
    if (clienteUsuario?.fcmToken) {
      await sendToToken(
        clienteUsuario.fcmToken,
        'Tu cierre fue revisado',
        `El viaje #${viaje.id} fue abierto como disputa. Un moderador lo está revisando.`,
        { tipo: 'viaje_estado', viajeId: String(viaje.id) }
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
    const zona = zonaDeConsulta(user, request.input('ciudad'))
    if (zona === false) {
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

    // Con zona, las reservas con conductor se acotan en SQL a los conductores
    // de la zona (ciudad normalizada); las que aún no tienen conductor se
    // resuelven por origen en memoria. El filtro de zona se aplica completo
    // antes de paginar, así `total` es exacto.
    const conductorIds = zona ? (await conductoresDeZona(zona)).conductorIds : null
    const candidatas = await Viaje.query()
      .where('tipo_programacion', 'programada')
      .if(conductorIds, (q) =>
        q.where((w) => w.whereIn('conductor_id', conductorIds!).orWhereNull('conductor_id'))
      )
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

    const zonas = zona ? await CoverageService.zonas() : []
    const enCiudad = zona
      ? candidatas.filter((v) => this.zonaDeReserva(v, zonas) === zona)
      : candidatas

    const total = enCiudad.length
    const inicio = (page - 1) * limit
    const pagina = enCiudad.slice(inicio, inicio + limit)

    // Mismo criterio que en `trips`: el contacto del cliente solo con caso abierto (o admin).
    const esAdmin = user.rol === 'admin'
    const casos = await casosPorViaje(pagina.map((t) => Number(t.id)))

    return serialize.withoutWrapping({
      data: pagina.map((t) => {
        const caso = casos.get(Number(t.id)) ?? casoVacio
        const contactoVisible = esAdmin || hayCaso(caso)
        return {
        id: t.id,
        clienteId: t.clienteId,
        conductorId: t.conductorId,
        estado: t.estado,
        estadoLabel: getTripEstadoLabel(t.estado),
        contactoVisible,
        tipoProgramacion: t.tipoProgramacion ?? 'programada',
        fechaProgramada: t.fechaProgramada,
        horaProgramada: t.horaProgramada,
        activacionAt: t.activacionAt?.toISO() ?? null,
        // "Pedir más plazo": el moderador lo ve, pero lo decide el cliente.
        plazo: t.plazoEstado
          ? { minutos: t.plazoMinutos, estado: t.plazoEstado, solicitadoAt: t.plazoSolicitadoAt?.toISO() ?? null }
          : null,
        origenDireccion: t.origenDireccion,
        origen: { lat: t.origenLat, lng: t.origenLng },
        destinoDireccion: t.destinoDireccion,
        destino: { lat: t.destinoLat, lng: t.destinoLng },
        carga: t.carga,
        precioEstimado: t.precioEstimado,
        precioFinal: t.precioFinal,
        motivoCancelacion: t.motivoCancelacion,
        cliente: t.cliente
          ? contactoVisible
            ? {
                id: t.cliente.id,
                nombre: `${t.cliente.nombre || ''} ${t.cliente.apellido || ''}`.trim(),
                telefono: t.cliente.telefono,
                email: t.cliente.email,
              }
            : { id: t.cliente.id, nombre: nombreCorto(t.cliente), telefono: null, email: null }
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
        }
      }),
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
    if (viaje.conductor?.ciudad) return claveDe(viaje.conductor.ciudad)
    if (viaje.origenLat === null || viaje.origenLng === null) return null
    return CoverageService.zonaDeEn(zonas, Number(viaje.origenLat), Number(viaje.origenLng))?.clave ?? null
  }

  /**
   * Alertas de la zona: las de viajes cuyo conductor es de la zona o las
   * lanzadas por un conductor de la zona. La ciudad del conductor se compara
   * normalizada (ver conductoresDeZona).
   */
  private ciudadDeEmergencia(deZona: { conductorIds: number[]; usuarioIds: number[] }) {
    return filtroAlertasDeZona(deZona)
  }

  async emergencyCount({ auth, request, serialize, response }: HttpContext) {
    const user = auth.getUserOrFail()
    const zona = zonaDeConsulta(user, request.input('ciudad'))
    if (zona === false) {
      return response
        .status(403)
        .send(await serialize.withoutWrapping({ error: 'No tienes ciudad asignada' }))
    }
    const deZona = zona ? await conductoresDeZona(zona) : null

    const filas = await AlertaEmergencia.query()
      .if(deZona, (q) => q.where(this.ciudadDeEmergencia(deZona!)))
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
    const zona = zonaDeConsulta(user, request.input('ciudad'))
    if (zona === false) {
      return response
        .status(403)
        .send(await serialize.withoutWrapping({ error: 'No tienes ciudad asignada' }))
    }
    const deZona = zona ? await conductoresDeZona(zona) : null

    const page = Math.max(1, Number.parseInt(request.input('page', '1')) || 1)
    const limit = Math.min(100, Math.max(1, Number.parseInt(request.input('limit', '20')) || 20))
    const estado = request.input('estado', '')

    const alertas = await AlertaEmergencia.query()
      .if(deZona, (q) => q.where(this.ciudadDeEmergencia(deZona!)))
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

    return serialize.withoutWrapping({
      data: alertas.all().map((a) => {
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
          // Ya filtrado en datosMapaSos: solo si el conductor está conectado.
          conductorUbicacion: mapa.conductorUbicacion,
          sos: mapa.sos,
          observacion: a.observacion,
          administrador: a.moderadorAtendio
            ? `${a.moderadorAtendio.nombre || ''} ${a.moderadorAtendio.apellido || ''}`.trim()
            : null,
          // Mismo valor que `administrador` (se mantiene por compatibilidad).
          atendidoPor: a.moderadorAtendio
            ? `${a.moderadorAtendio.nombre || ''} ${a.moderadorAtendio.apellido || ''}`.trim()
            : null,
          atendidaAt: a.atendidaAt?.toISO() ?? null,
          resueltaAt: a.resueltaAt?.toISO() ?? null,
          resueltoPor: a.moderadorResolvio
            ? `${a.moderadorResolvio.nombre || ''} ${a.moderadorResolvio.apellido || ''}`.trim()
            : null,
          createdAt: a.createdAt.toISO(),
        }
      }),
      total: alertas.total,
      page,
      limit,
    })
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
    if (!puedeActuarEnZona(user, zona)) {
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

    // Si ya estaba atendida, quien la atiende es el moderador original.
    await alerta.load('moderadorAtendio', (q) => q.select('id', 'nombre', 'apellido'))
    const atendidoPor = alerta.moderadorAtendio
      ? `${alerta.moderadorAtendio.nombre || ''} ${alerta.moderadorAtendio.apellido || ''}`.trim()
      : null

    emitToModerators(zona || user.zonaModerador || '', 'moderator:emergency:update', {
      id: alerta.id,
      estado: alerta.estado,
      estadoLabel: getAlertaEstadoLabel(alerta.estado),
      atendidoPor,
      atendidaAt: alerta.atendidaAt?.toISO() ?? null,
    })

    return serialize.withoutWrapping({
      id: alerta.id,
      estado: alerta.estado,
      estadoLabel: getAlertaEstadoLabel(alerta.estado),
      atendidoPor,
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
    if (!puedeActuarEnZona(user, zona)) {
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
    // El viaje sale de 'sos' (antes quedaba atascado sin poder completarse).
    await restaurarViajeTrasSos(alerta)

    await alerta.load('usuario', (q) => q.select('id', 'nombre', 'apellido', 'telefono', 'email', 'rol'))
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

    emitToModerators(zona || user.zonaModerador || '', 'moderator:emergency:update', {
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
      // Quien atendió (puede ser otro moderador), no quien resuelve.
      atendidoPor: caso.atendidoPor,
      atendidaAt: alerta.atendidaAt?.toISO() ?? null,
      resueltoPor: `${user.nombre} ${user.apellido}`.trim(),
      resueltaAt: alerta.resueltaAt?.toISO() ?? null,
      observacion: alerta.observacion,
    })
  }
}

/**
 * Zona que aplica a una consulta del panel:
 *  - moderador: siempre su `zonaModerador` (nunca la del query);
 *  - admin: `?ciudad=` normalizada, o null (sin filtro) si falta o es 'general'.
 * Devuelve `false` si un moderador no tiene zona (el llamador responde 403).
 */
function zonaDeConsulta(user: User, ciudadQuery: unknown): string | null | false {
  if (user.rol === 'admin') {
    const clave = claveDe(String(ciudadQuery ?? ''))
    return clave && clave !== 'general' ? clave : null
  }
  const clave = claveDe(user.zonaModerador || '')
  return clave || false
}

/** Fila del conductor para los listados del moderador (verificación, inactivos, directorio). */
function resumenConductor(c: Conductor) {
  return {
    id: c.id,
    usuarioId: c.usuarioId,
    cedula: c.cedula,
    placa: c.placa,
    tipoVehiculo: c.tipoVehiculo,
    capacidad: c.capacidad,
    modeloVehiculo: c.modeloVehiculo,
    ciudad: c.ciudad,
    fotoConductor: c.fotoConductor || c.usuario?.avatar || null,
    fotoVehiculo: c.fotoVehiculo,
    online: c.online,
    calificacion: c.calificacion,
    totalViajes: c.totalViajes,
    horasActivo: c.horasActivo,
    ultimaActividadAt: c.ubicacionActualizadaEn?.toISO() ?? null,
    // Solo un conductor conectado entrega dónde está (regla del panel, 2026-10-08).
    ultimaUbicacion: ubicacionSiConectado(c),
    estadoVerificacion: c.estadoVerificacion,
    fotoCedula: SignedUploadService.sign(c.fotoCedula),
    fotoLicencia: SignedUploadService.sign(c.fotoLicencia),
    faltantes: c.documentosFaltantes(),
    notaRechazo: c.notaRechazo,
    usuario: c.usuario
      ? {
          id: c.usuario.id,
          nombre: `${c.usuario.nombre || ''} ${c.usuario.apellido || ''}`.trim(),
          telefono: c.usuario.telefono,
          email: c.usuario.email,
          avatar: c.usuario.avatar,
          estadoCuenta: c.usuario.estadoCuenta,
        }
      : null,
    createdAt: c.createdAt.toISO(),
  }
}

/** Filtro de texto del directorio: nombre, apellido, cédula o placa. */
function coincideConductor(c: Conductor, buscar: string) {
  const q = buscar.toLowerCase()
  return (
    `${c.usuario?.nombre || ''} ${c.usuario?.apellido || ''}`.toLowerCase().includes(q) ||
    (c.cedula || '').toLowerCase().includes(q) ||
    (c.placa || '').toLowerCase().includes(q)
  )
}

/**
 * Atender/resolver una emergencia: el admin siempre; el moderador solo si la
 * zona de la alerta se pudo resolver y coincide (normalizada) con la suya.
 */
function puedeActuarEnZona(user: User, zona: string | null): boolean {
  if (user.rol === 'admin') return true
  if (!zona || !user.zonaModerador) return false
  return claveDe(zona) === claveDe(user.zonaModerador)
}

function numeroLatLng(val: unknown): number | null {
  return typeof val === 'string' && val.trim() !== '' ? Number(val) : (val as number | null)
}

/** Fecha de un agregado SQL crudo: Date en Postgres, texto en SQLite. */
function fechaSql(val: unknown): string | null {
  if (!val) return null
  const dt = val instanceof Date ? DateTime.fromJSDate(val) : DateTime.fromSQL(String(val))
  return dt.isValid ? dt.toISO() : null
}
