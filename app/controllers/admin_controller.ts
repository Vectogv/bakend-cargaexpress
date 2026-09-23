import User from '#models/user'
import Conductor from '#models/conductor'
import Ganancia from '#models/ganancia'
import Viaje from '#models/viaje'
import Reporte from '#models/reporte'
import AlertaEmergencia from '#models/alerta_emergencia'
import Disputa from '#models/disputa'
import ConfiguracionPlataforma from '#models/configuracion_plataforma'
import Comunicado from '#models/comunicado'
import Encuesta from '#models/encuesta'
import ReporteModerador from '#models/reporte_moderador'
import LogRespaldo from '#models/log_respaldo'
import SolicitudCancelacion from '#models/solicitud_cancelacion'
import TripStateMachine, { type EstadoViaje } from '#services/trip_state_machine'
import type { HttpContext } from '@adonisjs/core/http'
import db from '@adonisjs/lucid/services/db'
import RedisService from '#services/redis_service'
import SessionService from '#services/session_service'
import CoverageService, { validarZonasEntrada } from '#services/coverage_service'
import { DateTime } from 'luxon'
import StorageService from '#services/storage_service'
import { randomUUID } from 'node:crypto'
import {
  emitToDriver,
  emitToClient,
  emitToUser,
  emitToAdmin,
  emitTripStatusChanged,
} from '#start/socket'
import TripFinalizationService from '#services/trip_finalization_service'
import { DIAS_PLAZO_DEUDA_COMISION } from '#services/driver_debt_suspension_service'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import { emitTripUpdateToModerators } from '#services/moderator_trip_events'
import { sendToMultiple } from '#services/push_notification_service'
import SignedUploadService from '#services/signed_upload_service'
import {
  COLUMNAS_CONDUCTOR_MAPA_SOS,
  COLUMNAS_VIAJE_MAPA_SOS,
  datosMapaSos,
} from '#services/emergency_payload'
import { adminUpdateUserValidator } from '#validators/user'

export default class AdminController {
  async dashboard({ serialize }: HttpContext) {
    const cached = await RedisService.cacheGet<any>('admin:dashboard')
    if (cached) return serialize.withoutWrapping(cached)

    const now = DateTime.now()
    const startOfDay = now.startOf('day').toSQL()
    const startOfMonth = now.startOf('month').toSQL()

    const [
      totalUsers,
      totalDrivers,
      activeVehicles,
      todayShipments,
      totalEarnings,
      todayEarnings,
      monthEarnings,
    ] = await Promise.all([
      User.query().count('* as total').first(),
      Conductor.query().count('* as total').first(),
      Conductor.query().where('online', true).count('* as total').first(),
      Viaje.query()
        .whereIn('estado', ['finalizado'])
        .where('created_at', '>=', startOfDay)
        .count('* as total')
        .first(),
      Ganancia.query().sum('monto as total').first(),
      Ganancia.query().where('created_at', '>=', startOfDay).sum('monto as total').first(),
      Ganancia.query().where('created_at', '>=', startOfMonth).sum('monto as total').first(),
    ])

    const data = {
      totalUsers: Number(totalUsers?.$extras?.total || 0),
      totalDrivers: Number(totalDrivers?.$extras?.total || 0),
      activeVehicles: Number(activeVehicles?.$extras?.total || 0),
      todayShipments: Number(todayShipments?.$extras?.total || 0),
      totalEarnings: Number(totalEarnings?.$extras?.total || 0),
      todayEarnings: Number(todayEarnings?.$extras?.total || 0),
      monthEarnings: Number(monthEarnings?.$extras?.total || 0),
    }

    await RedisService.cacheSet('admin:dashboard', data, 60)
    return serialize.withoutWrapping(data)
  }

  async users({ request, response, serialize }: HttpContext) {
    const page = Math.max(1, Number.parseInt(request.input('page', '1')) || 1)
    const limit = Math.min(100, Math.max(1, Number.parseInt(request.input('limit', '20')) || 20))
    const search = String(request.input('search') || '').trim()
    const rol = String(request.input('rol') || '').trim()

    let query = User.query()
      .select(
        'id',
        'nombre',
        'apellido',
        'email',
        'rol',
        'telefono',
        'edad',
        'avatar',
        'suspendido',
        'es_moderador',
        'zona_moderador',
        'es_lider',
        'created_at'
      )
      .orderBy('created_at', 'desc')

    if (search) {
      query = query.where((sub) =>
        sub
          .whereILike('nombre', `%${search}%`)
          .orWhereILike('apellido', `%${search}%`)
          .orWhereILike('email', `%${search}%`)
          .orWhereILike('telefono', `%${search}%`)
      )
    }

    // Filtro por rol del panel: admin | cliente | conductor | moderador | lider
    if (rol === 'moderador') query = query.where('es_moderador', true)
    else if (rol === 'lider') query = query.where('es_lider', true)
    else if (rol === 'cliente') query = query.where('rol', 'cliente').where('es_moderador', false)
    else if (['admin', 'conductor'].includes(rol)) query = query.where('rol', rol)

    const result = await query.paginate(page, limit)

    // La respuesta sigue siendo un array (compatibilidad); la paginación va en cabeceras.
    response.header('X-Total-Count', String(result.total))
    response.header('X-Last-Page', String(result.lastPage))

    return serialize.withoutWrapping(
      result.all().map((u) => ({
        id: u.id,
        nombre: u.nombre,
        apellido: u.apellido,
        email: u.email,
        rol: u.rol,
        telefono: u.telefono,
        edad: u.edad,
        avatar: u.avatar,
        suspendido: u.suspendido,
        esModerador: u.esModerador,
        zonaModerador: u.zonaModerador,
        esLider: u.esLider,
        createdAt: u.createdAt?.toISO(),
      }))
    )
  }

  async drivers({ request, serialize }: HttpContext) {
    const page = Math.max(1, Number.parseInt(request.input('page', '1')) || 1)
    const limit = Math.min(100, Math.max(1, Number.parseInt(request.input('limit', '20')) || 20))
    const result = await Conductor.query()
      .preload('usuario', (q) =>
        q.select('id', 'nombre', 'apellido', 'email', 'telefono', 'suspendido')
      )
      .orderBy('created_at', 'desc')
      .paginate(page, limit)

    return serialize.withoutWrapping(
      result.all().map((d) => ({
        id: d.id,
        usuarioId: d.usuarioId,
        cedula: d.cedula,
        placa: d.placa,
        tipoVehiculo: d.tipoVehiculo,
        capacidad: d.capacidad,
        ciudad: d.ciudad,
        online: d.online,
        calificacion: d.calificacion,
        totalViajes: d.totalViajes,
        horasActivo: d.horasActivo,
        ultimaUbicacion: d.ultimaUbicacionLat
          ? { lat: d.ultimaUbicacionLat, lng: d.ultimaUbicacionLng }
          : null,
        estadoVerificacion: d.estadoVerificacion,
        fotoCedula: SignedUploadService.sign(d.fotoCedula),
        fotoLicencia: SignedUploadService.sign(d.fotoLicencia),
        notaRechazo: d.notaRechazo,
        fotoConductor: d.fotoConductor,
        fotoVehiculo: d.fotoVehiculo,
        usuario: d.usuario
          ? {
              nombre: d.usuario.nombre,
              apellido: d.usuario.apellido,
              email: d.usuario.email,
              telefono: d.usuario.telefono,
              suspendido: d.usuario.suspendido,
            }
          : null,
        createdAt: d.createdAt.toISO(),
      }))
    )
  }

  async trips({ request, serialize }: HttpContext) {
    const page = Math.max(1, Number.parseInt(request.input('page', '1')) || 1)
    const limit = Math.min(100, Math.max(1, Number.parseInt(request.input('limit', '20')) || 20))
    const result = await Viaje.query()
      .preload('cliente', (q) => q.select('id', 'nombre', 'apellido', 'email'))
      .preload('conductor', (q) =>
        q
          .select('id', 'placa', 'tipoVehiculo', 'usuario_id')
          .preload('usuario', (uq) => uq.select('id', 'nombre', 'apellido'))
      )
      .orderBy('created_at', 'desc')
      .paginate(page, limit)

    return serialize.withoutWrapping(
      result.all().map((t) => ({
        id: t.id,
        clienteId: t.clienteId,
        conductorId: t.conductorId,
        estado: t.estado,
        origenDireccion: t.origenDireccion,
        destinoDireccion: t.destinoDireccion,
        carga: t.carga,
        precioEstimado: t.precioEstimado,
        precioFinal: t.precioFinal,
        motivoCancelacion: t.motivoCancelacion,
        calificacionCliente: t.calificacionCliente,
        cliente: t.cliente
          ? {
              nombre: t.cliente.nombre,
              apellido: t.cliente.apellido,
              email: t.cliente.email,
            }
          : null,
        conductor: t.conductor
          ? {
              placa: t.conductor.placa,
              tipoVehiculo: t.conductor.tipoVehiculo,
              nombre: t.conductor.usuario?.nombre,
              apellido: t.conductor.usuario?.apellido,
            }
          : null,
        createdAt: t.createdAt.toISO(),
        aceptadoAt: t.aceptadoAt?.toISO() ?? null,
        completadoAt: t.completadoAt?.toISO() ?? null,
        finalizadoAt: t.finalizadoAt?.toISO() ?? null,
        canceladoAt: t.canceladoAt?.toISO() ?? null,
        enCursoAt: t.enCursoAt?.toISO() ?? null,
      }))
    )
  }

  async earnings({ request, serialize }: HttpContext) {
    const page = Math.max(1, Number.parseInt(request.input('page', '1')) || 1)
    const limit = Math.min(100, Math.max(1, Number.parseInt(request.input('limit', '20')) || 20))
    const result = await Ganancia.query()
      .preload('conductor', (q) =>
        q
          .select('id', 'placa', 'usuario_id')
          .preload('usuario', (uq) => uq.select('id', 'nombre', 'apellido', 'email'))
      )
      .preload('viaje', (q) => q.select('id', 'origen_direccion', 'destino_direccion', 'estado'))
      .orderBy('created_at', 'desc')
      .paginate(page, limit)

    return serialize.withoutWrapping(
      result.all().map((g) => ({
        id: g.id,
        monto: g.monto,
        conductorId: g.conductorId,
        viajeId: g.viajeId,
        conductor: g.conductor
          ? {
              placa: g.conductor.placa,
              nombre: g.conductor.usuario?.nombre,
              apellido: g.conductor.usuario?.apellido,
              email: g.conductor.usuario?.email,
            }
          : null,
        viaje: g.viaje
          ? {
              origen: g.viaje.origenDireccion,
              destino: g.viaje.destinoDireccion,
              estado: g.viaje.estado,
            }
          : null,
        createdAt: g.createdAt.toISO(),
      }))
    )
  }

  async updateUser({ params, request, response, serialize }: HttpContext) {
    const user = await User.find(params.id)
    if (!user) {
      return response
        .status(404)
        .send(await serialize.withoutWrapping({ error: 'Usuario no encontrado' }))
    }
    const data = await request.validateUsing(adminUpdateUserValidator)
    if (data.email && data.email !== user.email) {
      const exists = await User.findBy('email', data.email)
      if (exists) {
        return response
          .status(422)
          .send(await serialize.withoutWrapping({ error: 'El email ya está en uso' }))
      }
    }
    user.merge(data)
    await user.save()
    return serialize.withoutWrapping({
      id: user.id,
      nombre: user.nombre,
      apellido: user.apellido,
      email: user.email,
      telefono: user.telefono,
      edad: user.edad,
    })
  }

  async updateUserRole({ params, request, response, serialize }: HttpContext) {
    const user = await User.find(params.id)
    if (!user) {
      return response
        .status(404)
        .send(await serialize.withoutWrapping({ error: 'Usuario no encontrado' }))
    }
    const { rol } = request.only(['rol'])
    if (!rol || !['conductor', 'cliente', 'admin'].includes(rol)) {
      return response
        .status(422)
        .send(await serialize.withoutWrapping({ error: 'rol inválido (conductor, cliente, admin)' }))
    }
    if (rol !== 'admin' && user.rol === 'admin' && user.esModerador && !user.zonaModerador) {
      return response
        .status(422)
        .send(await serialize.withoutWrapping({ error: 'Asigna zonaModerador antes de quitar el rol admin' }))
    }
    user.rol = rol
    await user.save()
    RedisService.cacheDel('admin:dashboard')
    return serialize.withoutWrapping({
      id: user.id,
      rol: user.rol,
      esModerador: user.esModerador,
      zonaModerador: user.zonaModerador,
    })
  }

  async toggleSuspendUser({ params, response, serialize }: HttpContext) {
    const user = await User.find(params.id)
    if (!user) {
      return response
        .status(404)
        .send(await serialize.withoutWrapping({ error: 'Usuario no encontrado' }))
    }
    if (user.rol === 'admin') {
      return response
        .status(403)
        .send(await serialize.withoutWrapping({ error: 'No puedes suspender a otro admin' }))
    }
    user.suspendido = !user.suspendido
    await user.save()
    if (user.suspendido) await SessionService.revokeAll(user)
    RedisService.cacheDel('admin:dashboard')
    return serialize.withoutWrapping({
      id: user.id,
      suspendido: user.suspendido,
    })
  }

  async uploadUserAvatar({ params, request, response, serialize }: HttpContext) {
    const user = await User.find(params.id)
    if (!user) {
      return response
        .status(404)
        .send(await serialize.withoutWrapping({ error: 'Usuario no encontrado' }))
    }
    const file = request.file('file', {
      size: '5mb',
      extnames: ['jpg', 'jpeg', 'png', 'gif', 'webp'],
    })
    if (!file) {
      return serialize.withoutWrapping({ error: 'No file uploaded' })
    }
    if (!file.isValid) {
      return response.status(422).send({ error: file.errors[0]?.message || 'Archivo inválido' })
    }
    const fileName = `avatar-${user.id}-${randomUUID()}.${file.extname}`
    await file.move(StorageService.uploadsDir(), { name: fileName })
    user.avatar = `/storage/uploads/${fileName}`
    await user.save()
    return serialize.withoutWrapping({ avatar: user.avatar })
  }

  async deleteUser({ params, response, serialize }: HttpContext) {
    const user = await User.find(params.id)
    if (!user) {
      return response
        .status(404)
        .send(await serialize.withoutWrapping({ error: 'Usuario no encontrado' }))
    }
    if (user.rol === 'admin') {
      return response
        .status(403)
        .send(await serialize.withoutWrapping({ error: 'No puedes eliminar a otro admin' }))
    }
    // Todo o nada: si algún registro relacionado impide el borrado (FK), no se
    // deja la cuenta a medio eliminar.
    try {
      await db.transaction(async (trx) => {
        if (user.rol === 'conductor') {
          const conductor = await Conductor.query({ client: trx }).where('usuario_id', user.id).first()
          if (conductor) {
            await Ganancia.query({ client: trx }).where('conductor_id', conductor.id).delete()
            await conductor.useTransaction(trx).delete()
          }
        }
        await Viaje.query({ client: trx }).where('cliente_id', user.id).delete()
        await user.useTransaction(trx).delete()
      })
    } catch (err) {
      return response.status(409).send(
        await serialize.withoutWrapping({
          error: 'No se puede eliminar: el usuario tiene registros asociados (viajes, disputas o pagos). Suspéndelo en su lugar.',
        })
      )
    }
    await SessionService.revokeAll(user)
    RedisService.cacheDel('admin:dashboard')
    return serialize.withoutWrapping({ success: true })
  }

  async profile({ auth, serialize }: HttpContext) {
    const user = auth.getUserOrFail()
    return serialize.withoutWrapping({
      id: user.id,
      nombre: user.nombre,
      apellido: user.apellido,
      email: user.email,
      telefono: user.telefono,
      avatar: user.avatar,
      createdAt: user.createdAt?.toISO(),
    })
  }

  async updateProfile({ auth, request, response, serialize }: HttpContext) {
    const user = auth.getUserOrFail()
    const data = request.only(['nombre', 'apellido', 'email', 'telefono'])
    if (data.email && data.email !== user.email) {
      const exists = await User.findBy('email', data.email)
      if (exists) {
        return response.status(422).send(await serialize.withoutWrapping({ error: 'El email ya está en uso' }))
      }
    }
    user.merge(data)
    await user.save()
    return serialize.withoutWrapping({
      id: user.id,
      nombre: user.nombre,
      apellido: user.apellido,
      email: user.email,
      telefono: user.telefono,
      avatar: user.avatar,
    })
  }

  async uploadProfileAvatar({ auth, request, response, serialize }: HttpContext) {
    const user = auth.getUserOrFail()
    const file = request.file('file', {
      size: '5mb',
      extnames: ['jpg', 'jpeg', 'png', 'gif', 'webp'],
    })
    if (!file) {
      return serialize.withoutWrapping({ error: 'No file uploaded' })
    }
    if (!file.isValid) {
      return response.status(422).send({ error: file.errors[0]?.message || 'Archivo inválido' })
    }
    const fileName = `avatar-${user.id}-${randomUUID()}.${file.extname}`
    await file.move(StorageService.uploadsDir(), { name: fileName })
    user.avatar = `/storage/uploads/${fileName}`
    await user.save()
    return serialize.withoutWrapping({ avatar: user.avatar })
  }

  async conductorDebt({ serialize }: HttpContext) {
    const rows = await db
      .from('conductores')
      .select(
        'conductores.id',
        'conductores.usuario_id',
        'conductores.placa',
        'conductores.ciudad',
        'users.nombre',
        'users.apellido',
        'users.email',
        db.raw('COALESCE(SUM(ganancias.monto_bruto), 0) as total_bruto'),
        db.raw('COALESCE(SUM(ganancias.monto_neto), 0) as total_neto'),
        db.raw("COALESCE(SUM(CASE WHEN ganancias.comision_pagada = false THEN ganancias.comision ELSE 0 END), 0) as comision_pendiente")
      )
      .leftJoin('users', 'conductores.usuario_id', 'users.id')
      .leftJoin('ganancias', 'ganancias.conductor_id', 'conductores.id')
      .groupBy('conductores.id', 'conductores.usuario_id', 'conductores.placa', 'conductores.ciudad', 'users.nombre', 'users.apellido', 'users.email')
      .having(db.raw("COALESCE(SUM(CASE WHEN ganancias.comision_pagada = false THEN ganancias.comision ELSE 0 END), 0)"), '>', 0)

    return serialize.withoutWrapping(
      rows.map((r: any) => ({
        conductorId: r.id,
        nombre: `${r.nombre || ''} ${r.apellido || ''}`.trim(),
        email: r.email,
        placa: r.placa,
        ciudad: r.ciudad,
        totalBruto: Number(r.total_bruto),
        totalNeto: Number(r.total_neto),
        comisionPendiente: Number(r.comision_pendiente),
        monto: Number(r.comision_pendiente),
        pagada: false,
      }))
    )
  }

  async markCommissionPaid({ params, response, serialize }: HttpContext) {
    const conductor = await Conductor.find(params.conductorId)
    if (!conductor) {
      return response
        .status(404)
        .send(await serialize.withoutWrapping({ error: 'Conductor no encontrado' }))
    }

    const now = DateTime.now().toFormat('yyyy-MM-dd HH:mm:ss')
    await Ganancia.query()
      .where('conductor_id', conductor.id)
      .where('comision_pagada', false)
      .update({ comision_pagada: true, comision_pagada_at: now })

    return serialize.withoutWrapping({
      success: true,
      conductorId: conductor.id,
      marcadasPagadas: now,
    })
  }

  async commissionHistory({ params, request, response, serialize }: HttpContext) {
    const conductor = await Conductor.find(params.conductorId)
    if (!conductor) {
      return response
        .status(404)
        .send(await serialize.withoutWrapping({ error: 'Conductor no encontrado' }))
    }

    const page = Math.max(1, Number.parseInt(request.input('page', '1')) || 1)
    const limit = Math.min(100, Math.max(1, Number.parseInt(request.input('limit', '20')) || 20))
    const comisiones = await Ganancia.query()
      .where('conductor_id', conductor.id)
      .whereNotNull('comision')
      .preload('viaje', (q) => q.select('id', 'origen_direccion', 'destino_direccion'))
      .orderBy('created_at', 'desc')
      .paginate(page, limit)

    return serialize.withoutWrapping(
      comisiones.all().map((g) => ({
        id: g.id,
        viajeId: g.viajeId,
        montoBruto: g.montoBruto,
        comision: g.comision,
        montoNeto: g.montoNeto,
        pagada: g.comisionPagada,
        pagadaAt: g.comisionPagadaAt?.toISO() || null,
        viaje: g.viaje
          ? { origen: g.viaje.origenDireccion, destino: g.viaje.destinoDireccion }
          : null,
        createdAt: g.createdAt.toISO(),
      }))
    )
  }

  async reports({ request, serialize }: HttpContext) {
    const page = Math.max(1, Number.parseInt(request.input('page', '1')) || 1)
    const limit = Math.min(100, Math.max(1, Number.parseInt(request.input('limit', '20')) || 20))
    const reportes = await Reporte.query()
      .preload('cliente', (q) =>
        q.select('id', 'nombre', 'apellido', 'email', 'reputacion', 'visibilidad')
      )
      .preload('conductor', (q) =>
        q.select('id', 'placa').preload('usuario', (uq) => uq.select('id', 'nombre', 'apellido'))
      )
      .preload('viaje', (q) => q.select('id', 'origen_direccion', 'destino_direccion', 'estado'))
      .orderBy('created_at', 'desc')
      .paginate(page, limit)

    return serialize.withoutWrapping(
      reportes.all().map((r) => ({
        id: r.id,
        viajeId: r.viajeId,
        conductorId: r.conductorId,
        clienteId: r.clienteId,
        motivo: r.motivo,
        descripcion: r.descripcion,
        estado: r.estado,
        cliente: r.cliente
          ? {
              nombre: `${r.cliente.nombre || ''} ${r.cliente.apellido || ''}`.trim(),
              email: r.cliente.email,
              reputacion: r.cliente.reputacion,
              visibilidad: r.cliente.visibilidad,
            }
          : null,
        conductor: r.conductor
          ? {
              nombre:
                `${r.conductor.usuario?.nombre || ''} ${r.conductor.usuario?.apellido || ''}`.trim(),
              placa: r.conductor.placa,
            }
          : null,
        viaje: r.viaje
          ? {
              origen: r.viaje.origenDireccion,
              destino: r.viaje.destinoDireccion,
              estado: r.viaje.estado,
            }
          : null,
        createdAt: r.createdAt.toISO(),
      }))
    )
  }

  async resolveReport({ params, response, serialize }: HttpContext) {
    const reporte = await Reporte.find(params.id)
    if (!reporte) {
      return response
        .status(404)
        .send(await serialize.withoutWrapping({ error: 'Reporte no encontrado' }))
    }

    reporte.estado = 'resuelto'
    await reporte.save()

    return serialize.withoutWrapping({
      id: reporte.id,
      estado: reporte.estado,
    })
  }

  async pendingVerifications({ request, serialize }: HttpContext) {
    const page = Math.max(1, Number.parseInt(request.input('page', '1')) || 1)
    const limit = Math.min(100, Math.max(1, Number.parseInt(request.input('limit', '20')) || 20))
    const conductores = await Conductor.query()
      .where('estado_verificacion', 'pendiente')
      .preload('usuario', (q) => q.select('id', 'nombre', 'apellido', 'email', 'telefono'))
      .orderBy('created_at', 'asc')
      .paginate(page, limit)

    return serialize.withoutWrapping(
      conductores.all().map((c) => ({
        id: c.id,
        usuarioId: c.usuarioId,
        cedula: c.cedula,
        placa: c.placa,
        tipoVehiculo: c.tipoVehiculo,
        capacidad: c.capacidad,
        fotoCedula: SignedUploadService.sign(c.fotoCedula),
        fotoLicencia: SignedUploadService.sign(c.fotoLicencia),
        fotoVehiculo: c.fotoVehiculo,
        usuario: c.usuario
          ? {
              nombre: c.usuario.nombre,
              apellido: c.usuario.apellido,
              email: c.usuario.email,
              telefono: c.usuario.telefono,
            }
          : null,
        createdAt: c.createdAt.toISO(),
      }))
    )
  }

  async approveDriver({ params, response, serialize }: HttpContext) {
    const conductor = await Conductor.find(params.conductorId)
    if (!conductor) {
      return response
        .status(404)
        .send(await serialize.withoutWrapping({ error: 'Conductor no encontrado' }))
    }

    conductor.estadoVerificacion = 'aprobado'
    conductor.notaRechazo = null
    await conductor.save()

    emitToDriver(conductor.usuarioId, 'driver:approved', {
      conductorId: conductor.id,
      estado: conductor.estadoVerificacion,
    })

    return serialize.withoutWrapping({
      conductorId: conductor.id,
      estadoVerificacion: conductor.estadoVerificacion,
    })
  }

  async rejectDriver({ params, request, response, serialize }: HttpContext) {
    const conductor = await Conductor.find(params.conductorId)
    if (!conductor) {
      return response
        .status(404)
        .send(await serialize.withoutWrapping({ error: 'Conductor no encontrado' }))
    }

    const { nota } = request.only(['nota'])
    conductor.estadoVerificacion = 'rechazado'
    conductor.notaRechazo = nota || null
    await conductor.save()

    emitToDriver(conductor.usuarioId, 'driver:rejected', {
      conductorId: conductor.id,
      estado: conductor.estadoVerificacion,
      nota: conductor.notaRechazo,
    })

    return serialize.withoutWrapping({
      conductorId: conductor.id,
      estadoVerificacion: conductor.estadoVerificacion,
      nota: conductor.notaRechazo,
    })
  }

  async updateDriverCity({ params, request, response, serialize }: HttpContext) {
    const conductor = await Conductor.find(params.conductorId)
    if (!conductor) {
      return response
        .status(404)
        .send(await serialize.withoutWrapping({ error: 'Conductor no encontrado' }))
    }

    const { ciudad } = request.only(['ciudad'])
    if (!ciudad || typeof ciudad !== 'string') {
      return response
        .status(422)
        .send(await serialize.withoutWrapping({ error: 'ciudad es requerida' }))
    }
    const ciudadNormalizada = ciudad.trim().toLowerCase()
    const validas = ['cali', 'popayan', 'pasto', 'medellin', 'bogota', 'cartagena']
    if (!validas.includes(ciudadNormalizada)) {
      return response
        .status(422)
        .send(await serialize.withoutWrapping({ error: `Ciudad inválida (${validas.join(', ')})` }))
    }

    conductor.ciudad = ciudadNormalizada
    await conductor.save()

    return serialize.withoutWrapping({
      conductorId: conductor.id,
      ciudad: conductor.ciudad,
    })
  }

  async emergencies({ request, serialize }: HttpContext) {
    const page = Math.max(1, Number.parseInt(request.input('page', '1')) || 1)
    const limit = Math.min(100, Math.max(1, Number.parseInt(request.input('limit', '20')) || 20))
    const alertas = await AlertaEmergencia.query()
      .where('atendida', false)
      .preload('usuario', (q) => q.select('id', 'nombre', 'apellido', 'telefono'))
      .preload('viaje', (q) =>
        q
          .select('id', 'origen_direccion', 'destino_direccion', 'estado', ...COLUMNAS_VIAJE_MAPA_SOS)
          .preload('conductor', (cq) => cq.select(...COLUMNAS_CONDUCTOR_MAPA_SOS))
      )
      .orderBy('created_at', 'desc')
      .paginate(page, limit)

    return serialize.withoutWrapping(
      alertas.all().map((a) => {
        const mapa = datosMapaSos(a)
        return {
          id: a.id,
          userId: a.userId,
          viajeId: a.viajeId,
          lat: a.lat,
          lng: a.lng,
          atendida: a.atendida,
          usuario: a.usuario
            ? { nombre: a.usuario.nombre, apellido: a.usuario.apellido, telefono: a.usuario.telefono }
            : null,
          viaje: a.viaje
            ? {
                id: a.viaje.id,
                origen: a.viaje.origenDireccion,
                destino: a.viaje.destinoDireccion,
                estado: a.viaje.estado,
                origenCoords: mapa.origenCoords,
                destinoCoords: mapa.destinoCoords,
              }
            : null,
          conductorUbicacion: mapa.conductorUbicacion,
          sos: mapa.sos,
          createdAt: a.createdAt.toISO(),
        }
      })
    )
  }

  async sosAlerts({ request, serialize }: HttpContext) {
    const page = Math.max(1, Number.parseInt(request.input('page', '1')) || 1)
    const limit = Math.min(100, Math.max(1, Number.parseInt(request.input('limit', '50')) || 50))
    const alertas = await AlertaEmergencia.query()
      .preload('usuario', (q) => q.select('id', 'nombre', 'apellido'))
      .preload('viaje', (q) =>
        q
          .select('id', 'origen_direccion', 'destino_direccion', 'estado', ...COLUMNAS_VIAJE_MAPA_SOS)
          .preload('conductor', (cq) => cq.select(...COLUMNAS_CONDUCTOR_MAPA_SOS))
      )
      .orderBy('created_at', 'desc')
      .paginate(page, limit)

    return serialize.withoutWrapping(
      alertas.all().map((a) => {
        const mapa = datosMapaSos(a)
        return {
          id: a.id,
          driverId: a.userId ? String(a.userId) : null,
          tripId: a.viajeId ? String(a.viajeId) : null,
          latitude: a.lat !== null ? Number(a.lat) : null,
          longitude: a.lng !== null ? Number(a.lng) : null,
          speed: null,
          timestamp: a.createdAt.toISO(),
          status: a.estado === 'atendida' ? 'atendiendo' : a.estado === 'resuelta' ? 'resuelto' : 'pendiente',
          viaje: a.viaje
            ? {
                id: a.viaje.id,
                estado: a.viaje.estado,
                origen: a.viaje.origenDireccion,
                destino: a.viaje.destinoDireccion,
                origenCoords: mapa.origenCoords,
                destinoCoords: mapa.destinoCoords,
              }
            : null,
          conductorUbicacion: mapa.conductorUbicacion,
          sos: mapa.sos,
        }
      })
    )
  }

  async resolveEmergency({ params, response, serialize }: HttpContext) {
    const alerta = await AlertaEmergencia.find(params.id)
    if (!alerta) {
      return response.status(404).send(await serialize.withoutWrapping({ error: 'Alerta no encontrada' }))
    }

    alerta.atendida = true
    await alerta.save()

    return serialize.withoutWrapping({
      id: alerta.id,
      atendida: alerta.atendida,
    })
  }

  async disputes({ request, serialize }: HttpContext) {
    const page = Math.max(1, Number.parseInt(request.input('page', '1')) || 1)
    const limit = Math.min(100, Math.max(1, Number.parseInt(request.input('limit', '20')) || 20))
    const disputas = await Disputa.query()
      .whereIn('estado', ['abierta', 'en_revision'])
      .preload('viaje', (q) => q.select('id', 'origen_direccion', 'destino_direccion', 'precio_final'))
      .preload('conductor', (q) => q.select('id', 'placa', 'usuario_id').preload('usuario', (uq) => uq.select('id', 'nombre', 'apellido')))
      .preload('cliente', (q) => q.select('id', 'nombre', 'apellido', 'email'))
      .orderBy('created_at', 'desc')
      .paginate(page, limit)

    return serialize.withoutWrapping(
      disputas.all().map((d) => ({
        id: d.id,
        viajeId: d.viajeId,
        conductorId: d.conductorId,
        clienteId: d.clienteId,
        versionConductor: d.versionConductor,
        versionCliente: d.versionCliente,
        soporteCliente: SignedUploadService.sign(d.soporteCliente),
        fotos: SignedUploadService.sign(Array.isArray(d.fotos) ? d.fotos : []),
        estado: d.estado,
        resultado: d.resultado,
        viaje: d.viaje
          ? {
              origen: d.viaje.origenDireccion,
              destino: d.viaje.destinoDireccion,
              montoFinal: d.viaje.precioFinal,
            }
          : null,
        conductor: d.conductor
          ? {
              id: d.conductor.id,
              nombre:
                `${d.conductor.usuario?.nombre || ''} ${d.conductor.usuario?.apellido || ''}`.trim(),
              placa: d.conductor.placa,
            }
          : null,
        cliente: d.cliente
          ? {
              id: d.cliente.id,
              nombre: `${d.cliente.nombre || ''} ${d.cliente.apellido || ''}`.trim(),
              email: d.cliente.email,
            }
          : null,
        createdAt: d.createdAt.toISO(),
      }))
    )
  }

  /**
   * Lleva a un estado final el viaje de una disputa resuelta.
   *  • favor_conductor → 'finalizado' con TripFinalizationService (ganancia y
   *    comisión en una transacción idempotente, igual que confirm-close).
   *  • favor_cliente   → 'cancelado', sin ganancia ni comisión.
   * Solo actúa si el viaje sigue en 'disputa' (las disputas abiertas sobre
   * viajes ya finalizados no cambian su estado).
   */
  private async cerrarViajeEnDisputa(
    viajeId: number,
    resultado: 'favor_conductor' | 'favor_cliente',
    adminId: number
  ): Promise<{ ok: true; viaje: Viaje | null } | { ok: false; statusCode: number; error: string }> {
    const actual = await Viaje.find(viajeId)
    if (!actual || actual.estado !== 'disputa') return { ok: true, viaje: actual }

    if (resultado === 'favor_conductor') {
      const montoFinal = actual.precioFinal ?? actual.precioCliente ?? actual.precioEstimado ?? 0
      const result = await TripFinalizationService.finalize({
        viajeId,
        montoFinal,
        actorUserId: adminId,
        actorRol: 'admin',
      })
      if (!result.ok) return result
    } else {
      await db.transaction(async (trx) => {
        const viaje = await Viaje.query({ client: trx }).where('id', viajeId).forUpdate().first()
        if (!viaje || viaje.estado !== 'disputa') return
        viaje.estado = 'cancelado'
        viaje.motivoCancelacion = 'Disputa resuelta a favor del cliente'
        viaje.canceladoAt = DateTime.now()
        await viaje.useTransaction(trx).save()
      })
    }

    const viaje = await Viaje.find(viajeId)
    if (viaje) {
      const conductor = viaje.conductorId ? await Conductor.find(viaje.conductorId) : null
      emitTripStatusChanged(viaje.clienteId, conductor?.usuarioId, {
        id: String(viaje.id),
        estado: viaje.estado,
      })
      emitTripUpdateToModerators(viaje)
    }
    return { ok: true, viaje }
  }

  async resolveDispute({ auth, params, request, response, serialize }: HttpContext) {
    const disputa = await Disputa.find(params.id)
    if (!disputa) {
      return response
        .status(404)
        .send(await serialize.withoutWrapping({ error: 'Disputa no encontrada' }))
    }
    if (disputa.estado === 'resuelta') {
      return response
        .status(400)
        .send(await serialize.withoutWrapping({ error: 'La disputa ya fue resuelta' }))
    }

    const { resultado, acuerdoDePago, montoDeuda } = request.only([
      'resultado',
      'acuerdoDePago',
      'montoDeuda',
    ])
    if (!['favor_conductor', 'favor_cliente'].includes(resultado)) {
      return response.status(422).send(
        await serialize.withoutWrapping({
          error: 'Resultado inválido (favor_conductor, favor_cliente)',
        })
      )
    }

    // Toma la disputa de forma condicional: si dos admins la resuelven a la
    // vez, solo uno la procesa (el otro recibe 400).
    const estadoAnterior = disputa.estado
    const resueltaAt = DateTime.now()
    const tomadas = await Disputa.query()
      .where('id', disputa.id)
      .whereNot('estado', 'resuelta')
      .update({
        estado: 'resuelta',
        resultado,
        resuelta_at: resueltaAt.toFormat('yyyy-MM-dd HH:mm:ss'),
      })
    if (Number(Array.isArray(tomadas) ? tomadas[0] : tomadas) === 0) {
      return response
        .status(400)
        .send(await serialize.withoutWrapping({ error: 'La disputa ya fue resuelta' }))
    }
    disputa.estado = 'resuelta'
    disputa.resultado = resultado
    disputa.resueltaAt = resueltaAt

    // Cierra el viaje que quedó en 'disputa' (antes quedaba bloqueado para
    // siempre y el cliente no podía pedir otro viaje).
    const cierre = await this.cerrarViajeEnDisputa(disputa.viajeId, resultado, auth.user!.id)
    if (!cierre.ok) {
      await Disputa.query()
        .where('id', disputa.id)
        .update({ estado: estadoAnterior, resultado: null, resuelta_at: null })
      return response
        .status(cierre.statusCode)
        .send(await serialize.withoutWrapping({ error: cierre.error }))
    }

    if (resultado === 'favor_conductor') {
      const cliente = await User.find(disputa.clienteId)
      if (cliente) {
        if (acuerdoDePago) {
          cliente.estadoCuenta = 'suspension_por_pago'
          cliente.montoDeuda = montoDeuda || null
          cliente.deudaFechaLimite = DateTime.now().plus({ days: 10 })
          cliente.tieneDeudaActiva = true
          emitToClient(disputa.clienteId, 'dispute:resolved', {
            disputaId: disputa.id,
            resultado,
            estado: 'resuelta',
            acuerdoDePago: true,
            montoDeuda: cliente.montoDeuda,
            deudaFechaLimite: cliente.deudaFechaLimite.toISO(),
            message: 'Se ha generado un acuerdo de pago. Tienes 10 días para pagar.',
          })
        } else {
          cliente.tieneDeudaActiva = true
          emitToClient(disputa.clienteId, 'dispute:resolved', {
            disputaId: disputa.id,
            resultado,
            estado: 'resuelta',
            message: 'La disputa se resolvió a favor del conductor. Tienes una deuda activa.',
          })
        }
        await cliente.save()
      }
      const conductor = await Conductor.find(disputa.conductorId)
      if (conductor) {
        emitToDriver(conductor.usuarioId, 'dispute:resolved', {
          disputaId: disputa.id,
          resultado,
          estado: 'resuelta',
          message: 'La disputa se resolvió a tu favor.',
        })
      }
    } else {
      const conductor = await Conductor.find(disputa.conductorId)
      if (conductor) {
        const conductorUser = await User.find(conductor.usuarioId)
        if (conductorUser) {
          conductorUser.reportesInfundadosConductor += 1
          await conductorUser.save()
          emitToDriver(conductorUser.id, 'dispute:resolved', {
            disputaId: disputa.id,
            resultado,
            estado: 'resuelta',
            message: 'La disputa se resolvió a favor del cliente. Quedas bajo observación.',
          })
          if (conductorUser.reportesInfundadosConductor >= 2) {
            emitToAdmin('admin:conductor_observacion', {
              conductorId: conductor.id,
              usuarioId: conductorUser.id,
              reportes: conductorUser.reportesInfundadosConductor,
            })
          }
        }
      }
      emitToClient(disputa.clienteId, 'dispute:resolved', {
        disputaId: disputa.id,
        resultado,
        estado: 'resuelta',
        message: 'La disputa se resolvió a tu favor.',
      })
    }

    return serialize.withoutWrapping({
      id: disputa.id,
      estado: disputa.estado,
      resultado: disputa.resultado,
      resueltaAt: disputa.resueltaAt?.toISO(),
      viajeEstado: cierre.viaje?.estado ?? null,
    })
  }

  async clearDebt({ params, response, serialize }: HttpContext) {
    const user = await User.find(params.id)
    if (!user) {
      return response
        .status(404)
        .send(await serialize.withoutWrapping({ error: 'Usuario no encontrado' }))
    }
    user.tieneDeudaActiva = false
    user.estadoCuenta = 'activa'
    user.montoDeuda = null
    user.deudaFechaLimite = null
    user.comprobantePago = null
    user.montoComprobante = null
    user.comprobanteSubidoAt = null
    await user.save()
    return serialize.withoutWrapping({
      id: user.id,
      tieneDeudaActiva: user.tieneDeudaActiva,
      estadoCuenta: user.estadoCuenta,
    })
  }

  async pendingPayments({ serialize }: HttpContext) {
    const usuarios = await User.query()
      .where('estado_cuenta', 'esperando_confirmacion')
      .whereNotNull('comprobante_pago')
      .select(
        'id',
        'nombre',
        'apellido',
        'email',
        'monto_deuda',
        'deuda_fecha_limite',
        'comprobante_pago',
        'monto_comprobante',
        'comprobante_subido_at',
        'created_at'
      )

    return serialize.withoutWrapping(
      usuarios.map((u) => ({
        id: u.id,
        userId: u.id,
        nombre: `${u.nombre} ${u.apellido}`.trim(),
        email: u.email,
        montoDeuda: u.montoDeuda,
        // Lo que cubre el comprobante (lo que se descuenta al aprobar).
        montoComprobante: u.montoComprobante,
        comprobanteSubidoAt: u.comprobanteSubidoAt?.toISO() || null,
        monto: Number(u.montoComprobante ?? u.montoDeuda ?? 0),
        concepto: 'Deuda activa',
        deudaFechaLimite: u.deudaFechaLimite?.toISO() || null,
        comprobante: SignedUploadService.sign(u.comprobantePago),
        createdAt: u.createdAt.toISO(),
      }))
    )
  }

  async confirmPayment({ params, response, serialize }: HttpContext) {
    const user = await User.find(params.userId)
    if (!user) {
      return response
        .status(404)
        .send(await serialize.withoutWrapping({ error: 'Usuario no encontrado' }))
    }
    if (user.estadoCuenta !== 'esperando_confirmacion') {
      return response
        .status(422)
        .send(await serialize.withoutWrapping({ error: 'El usuario no tiene un comprobante pendiente' }))
    }

    // Solo se descuenta lo que cubría el comprobante (la deuda al subirlo). Las
    // comisiones de viajes terminados durante la revisión siguen pendientes.
    // Con el usuario bloqueado para no pisar una finalización concurrente.
    const resultado = await db.transaction(async (trx) => {
      const u = await User.query({ client: trx }).where('id', user.id).forUpdate().firstOrFail()
      if (u.estadoCuenta !== 'esperando_confirmacion') return null

      const deuda = Number(u.montoDeuda) || 0
      // Comprobantes subidos antes de guardar el monto: cubren toda la deuda.
      const cubierto = u.montoComprobante !== null ? Number(u.montoComprobante) : deuda
      const restante = Math.max(0, Math.round((deuda - cubierto) * 100) / 100)

      if (u.rol === 'conductor') {
        await this.marcarComisionesCubiertas(u, cubierto, trx)
      }

      u.estadoCuenta = 'activa'
      u.comprobantePago = null
      u.montoComprobante = null
      u.comprobanteSubidoAt = null
      if (restante > 0) {
        u.montoDeuda = restante
        u.tieneDeudaActiva = true
        u.deudaFechaLimite = DateTime.now().plus({ days: DIAS_PLAZO_DEUDA_COMISION })
      } else {
        u.montoDeuda = null
        u.tieneDeudaActiva = false
        u.deudaFechaLimite = null
      }
      await u.useTransaction(trx).save()
      return u
    })

    if (!resultado) {
      return response
        .status(422)
        .send(await serialize.withoutWrapping({ error: 'El usuario no tiene un comprobante pendiente' }))
    }

    const restante = Number(resultado.montoDeuda) || 0
    const deudaFechaLimite = resultado.deudaFechaLimite?.toISO() ?? null
    const message =
      restante > 0
        ? `Tu pago ha sido confirmado y tu cuenta está activa. Te queda una deuda de $${restante.toLocaleString('es-CO')} por viajes terminados mientras se revisaba el comprobante; tienes ${DIAS_PLAZO_DEUDA_COMISION} días para pagarla.`
        : 'Tu pago ha sido confirmado. Tu cuenta está activa nuevamente.'

    // Cliente o conductor: el conductor escucha en su room driver:{id}.
    emitToUser(resultado.id, 'payment:confirmed', {
      message,
      estadoCuenta: resultado.estadoCuenta,
      montoDeuda: restante,
      deudaFechaLimite,
    })

    return serialize.withoutWrapping({
      id: resultado.id,
      estadoCuenta: resultado.estadoCuenta,
      montoDeuda: restante,
      deudaFechaLimite,
      message:
        restante > 0
          ? `Pago confirmado. Cuenta reactivada con deuda pendiente de $${restante}.`
          : 'Pago confirmado. Cuenta reactivada.',
    })
  }

  /**
   * Marca como pagadas las comisiones del conductor que cubre el comprobante:
   * de la más vieja a la más nueva, solo las cubiertas por completo y creadas
   * hasta que se subió el comprobante.
   */
  private async marcarComisionesCubiertas(user: User, cubierto: number, trx: TransactionClientContract) {
    const conductor = await Conductor.query({ client: trx }).where('usuario_id', user.id).first()
    if (!conductor || cubierto <= 0) return

    const hasta = user.comprobanteSubidoAt?.toMillis() ?? null
    const pendientes = await Ganancia.query({ client: trx })
      .where('conductor_id', conductor.id)
      .where('comision_pagada', false)
      .whereNotNull('comision')
      .orderBy('created_at', 'asc')
      .orderBy('id', 'asc')

    const ids: number[] = []
    let acumulado = 0
    for (const g of pendientes) {
      if (hasta !== null && g.createdAt.toMillis() > hasta) break
      const siguiente = Math.round((acumulado + Number(g.comision)) * 100) / 100
      if (siguiente > cubierto) break
      acumulado = siguiente
      ids.push(g.id)
    }
    if (ids.length === 0) return

    await Ganancia.query({ client: trx })
      .whereIn('id', ids)
      .update({ comision_pagada: true, comision_pagada_at: DateTime.now().toFormat('yyyy-MM-dd HH:mm:ss') })
  }

  async rejectPayment({ params, response, serialize }: HttpContext) {
    const user = await User.find(params.userId)
    if (!user) {
      return response
        .status(404)
        .send(await serialize.withoutWrapping({ error: 'Usuario no encontrado' }))
    }
    if (user.estadoCuenta !== 'esperando_confirmacion') {
      return response
        .status(422)
        .send(await serialize.withoutWrapping({ error: 'El usuario no tiene un comprobante pendiente' }))
    }

    user.estadoCuenta = 'suspension_por_pago'
    user.comprobantePago = null
    user.montoComprobante = null
    user.comprobanteSubidoAt = null
    await user.save()

    const diasRestantes = user.deudaFechaLimite
      ? Math.max(0, Math.ceil(user.deudaFechaLimite.diff(DateTime.now(), 'days').days))
      : 0

    emitToUser(user.id, 'payment:rejected', {
      message:
        diasRestantes > 0
          ? `Tu comprobante no fue válido. Te quedan ${diasRestantes} días para pagar.`
          : 'Tu comprobante no fue válido. Tu cuenta sigue suspendida: sube un nuevo comprobante de pago.',
      diasRestantes,
    })

    return serialize.withoutWrapping({
      id: user.id,
      estadoCuenta: user.estadoCuenta,
      message: 'Pago rechazado. El usuario vuelve a suspensión por pago.',
    })
  }

  async updateConfig({ request, serialize }: HttpContext) {
    let config = await ConfiguracionPlataforma.unica()
    if (!config) {
      config = await ConfiguracionPlataforma.create({})
    }

    const { nequiNumero, nequiNombre } = request.only(['nequiNumero', 'nequiNombre'])
    if (nequiNumero !== undefined) config.nequiNumero = nequiNumero
    if (nequiNombre !== undefined) config.nequiNombre = nequiNombre
    await config.save()
    RedisService.cacheDel('config:plataforma')

    return serialize.withoutWrapping({
      nequiNumero: config.nequiNumero,
      nequiNombre: config.nequiNombre,
    })
  }

  /** Zonas de operación tal como las edita el admin (incluye las inactivas). */
  async coverage({ serialize }: HttpContext) {
    return serialize.withoutWrapping({ zonasCobertura: await CoverageService.zonas() })
  }

  /**
   * Reemplaza las zonas de operación. Cada zona es un rectángulo:
   * { nombre, activa, norte, sur, este, oeste } (latitudes norte/sur, longitudes este/oeste).
   */
  async updateCoverage({ request, response, serialize }: HttpContext) {
    const resultado = validarZonasEntrada(request.input('zonasCobertura'))
    if ('error' in resultado) {
      return response.status(422).send(await serialize.withoutWrapping({ error: resultado.error }))
    }

    let config = await ConfiguracionPlataforma.unica()
    if (!config) {
      config = await ConfiguracionPlataforma.create({})
    }
    config.zonasCobertura = resultado.zonas
    await config.save()

    return serialize.withoutWrapping({ zonasCobertura: await CoverageService.zonas() })
  }

  async backupLogs({ serialize }: HttpContext) {
    const logs = await LogRespaldo.query().orderBy('created_at', 'desc').limit(30)

    return serialize.withoutWrapping(
      logs.map((l) => ({
        id: l.id,
        fecha: l.fecha.toISO(),
        estado: l.estado,
        archivo: l.archivo,
        driveId: l.driveId,
        errorMensaje: l.errorMensaje,
        createdAt: l.createdAt.toISO(),
      }))
    )
  }

  async manualBackup({ serialize }: HttpContext) {
    const { runBackup } = await import('#services/backup_service')
    await runBackup()
    return serialize.withoutWrapping({ success: true, message: 'Respaldo manual completado' })
  }

  async updateBanner({ request, response, serialize }: HttpContext) {
    let config = await ConfiguracionPlataforma.unica()
    if (!config) {
      config = await ConfiguracionPlataforma.create({})
    }

    const file = request.file('banner_imagen', {
      size: '2mb',
      extnames: ['jpg', 'jpeg', 'png', 'gif', 'webp'],
    })

    if (file) {
      if (!file.isValid) {
        return response.status(422).send({ error: file.errors[0]?.message || 'Archivo inválido' })
      }
      const fileName = `banner-${randomUUID()}.${file.extname}`
      await file.move(StorageService.uploadsDir(), { name: fileName })
      config.bannerImagenUrl = `/storage/uploads/${fileName}`
    }

    const { bannerActivo, bannerLink, bannerTexto } = request.only([
      'bannerActivo',
      'bannerLink',
      'bannerTexto',
    ])
    if (bannerActivo !== undefined)
      config.bannerActivo = bannerActivo === true || bannerActivo === 'true'
    if (bannerLink !== undefined) config.bannerLink = bannerLink
    if (bannerTexto !== undefined) config.bannerTexto = bannerTexto
    await config.save()

    return serialize.withoutWrapping({
      bannerActivo: config.bannerActivo,
      bannerImagenUrl: config.bannerImagenUrl,
      bannerLink: config.bannerLink,
      bannerTexto: config.bannerTexto,
    })
  }

  async assignModerator({ params, request, response, serialize }: HttpContext) {
    const user = await User.find(params.id)
    if (!user) {
      return response
        .status(404)
        .send(await serialize.withoutWrapping({ error: 'Usuario no encontrado' }))
    }

    const { esModerador, zonaModerador } = request.only(['esModerador', 'zonaModerador'])
    if (esModerador !== undefined) {
      user.esModerador = esModerador === true || esModerador === 'true'
    }
    if (zonaModerador !== undefined) {
      // La zona debe ser una de las configuradas por el admin en Cobertura. Antes
      // estaba fijada a cali/popayan/pasto, así que al añadir una ciudad nueva no
      // se le podía asignar ningún moderador.
      const clave = zonaModerador ? String(zonaModerador).trim().toLowerCase() : ''
      if (clave) {
        const configuradas = (await CoverageService.zonas()).map((z) => z.clave)
        const validas = configuradas.length > 0 ? configuradas : ['cali', 'popayan', 'pasto']
        if (!validas.includes(clave)) {
          return response.status(422).send(
            await serialize.withoutWrapping({
              error: `Zona inválida (${validas.join(', ')})`,
            })
          )
        }
      }
      user.zonaModerador = clave || null
    }
    await user.save()

    return serialize.withoutWrapping({
      id: user.id,
      esModerador: user.esModerador,
      zonaModerador: user.zonaModerador,
    })
  }

  async assignLeader({ params, request, response, serialize }: HttpContext) {
    const user = await User.find(params.id)
    if (!user) {
      return response
        .status(404)
        .send(await serialize.withoutWrapping({ error: 'Usuario no encontrado' }))
    }

    // Asignar/quitar rol de líder de conductores
    const { esLider } = request.only(['esLider'])
    if (esLider !== undefined) {
      user.esLider = esLider === true || esLider === 'true'
    }
    await user.save()

    return serialize.withoutWrapping({
      id: user.id,
      esLider: user.esLider,
    })
  }

  async resetPassword({ params, request, response, serialize }: HttpContext) {
    const user = await User.find(params.id)
    if (!user) {
      return response
        .status(404)
        .send(await serialize.withoutWrapping({ error: 'Usuario no encontrado' }))
    }

    if (user.rol === 'admin') {
      return response
        .status(403)
        .send(
          await serialize.withoutWrapping({
            error: 'No puedes cambiar la contraseña de otro administrador',
          })
        )
    }

    const { password } = request.only(['password'])
    if (!password || typeof password !== 'string' || password.length < 6 || password.length > 32) {
      return response
        .status(422)
        .send(
          await serialize.withoutWrapping({
            error: 'La contraseña debe tener entre 6 y 32 caracteres',
          })
        )
    }

    user.password = password
    await user.save()
    await SessionService.revokeAll(user)

    RedisService.cacheDel('admin:dashboard')

    return serialize.withoutWrapping({
      id: user.id,
      passwordActualizado: true,
    })
  }

  async approveComunicado({ params, response, serialize }: HttpContext) {
    const comunicado = await Comunicado.find(params.id)
    if (!comunicado) {
      return response
        .status(404)
        .send(await serialize.withoutWrapping({ error: 'Comunicado no encontrado' }))
    }
    if (comunicado.estado !== 'pendiente') {
      return response
        .status(422)
        .send(await serialize.withoutWrapping({ error: 'El comunicado ya fue procesado' }))
    }

    comunicado.estado = 'aprobado'
    comunicado.publicadoAt = DateTime.now()
    await comunicado.save()

    const tokenRows = await db.from('users').whereNotNull('fcm_token').select('fcm_token')
    const tokens = tokenRows.map((r: any) => r.fcm_token).filter(Boolean) as string[]

    if (tokens.length > 0) {
      await sendToMultiple(tokens, comunicado.titulo, comunicado.contenido)
    }

    return serialize.withoutWrapping({
      id: comunicado.id,
      estado: comunicado.estado,
      publicadoAt: comunicado.publicadoAt.toISO(),
    })
  }

  async rejectComunicado({ params, request, response, serialize }: HttpContext) {
    const comunicado = await Comunicado.find(params.id)
    if (!comunicado) {
      return response
        .status(404)
        .send(await serialize.withoutWrapping({ error: 'Comunicado no encontrado' }))
    }
    if (comunicado.estado !== 'pendiente') {
      return response
        .status(422)
        .send(await serialize.withoutWrapping({ error: 'El comunicado ya fue procesado' }))
    }

    const { notaRechazo } = request.only(['notaRechazo'])
    comunicado.estado = 'rechazado'
    comunicado.notaRechazo = notaRechazo || null
    await comunicado.save()

    return serialize.withoutWrapping({
      id: comunicado.id,
      estado: comunicado.estado,
      notaRechazo: comunicado.notaRechazo,
    })
  }

  async approveEncuesta({ params, response, serialize }: HttpContext) {
    const encuesta = await Encuesta.find(params.id)
    if (!encuesta) {
      return response
        .status(404)
        .send(await serialize.withoutWrapping({ error: 'Encuesta no encontrada' }))
    }
    if (encuesta.estado !== 'pendiente') {
      return response
        .status(422)
        .send(await serialize.withoutWrapping({ error: 'La encuesta ya fue procesada' }))
    }

    encuesta.estado = 'activa'
    await encuesta.save()

    const tokenRows = await db.from('users').whereNotNull('fcm_token').select('fcm_token')
    const tokens = tokenRows.map((r: any) => r.fcm_token).filter(Boolean) as string[]

    if (tokens.length > 0) {
      await sendToMultiple(tokens, 'Nueva encuesta disponible', encuesta.pregunta)
    }

    return serialize.withoutWrapping({
      id: encuesta.id,
      estado: encuesta.estado,
    })
  }

  async listComunicados({ request, serialize }: HttpContext) {
    const page = Math.max(1, Number.parseInt(request.input('page', '1')) || 1)
    const limit = Math.min(100, Math.max(1, Number.parseInt(request.input('limit', '20')) || 20))
    const comunicados = await Comunicado.query()
      .preload('moderador', (q) => q.select('id', 'nombre', 'apellido'))
      .orderBy('created_at', 'desc')
      .paginate(page, limit)

    return serialize.withoutWrapping(
      comunicados.all().map((c) => ({
        id: c.id,
        title: c.titulo,
        body: c.contenido,
        author: c.moderador
          ? `${c.moderador.nombre || ''} ${c.moderador.apellido || ''}`.trim()
          : 'Admin',
        status:
          c.estado === 'aprobado'
            ? 'approved'
            : c.estado === 'rechazado'
              ? 'rejected'
              : 'pending',
        createdAt: c.createdAt.toISO(),
      }))
    )
  }

  async listEncuestas({ request, serialize }: HttpContext) {
    const page = Math.max(1, Number.parseInt(request.input('page', '1')) || 1)
    const limit = Math.min(100, Math.max(1, Number.parseInt(request.input('limit', '20')) || 20))
    const encuestas = await Encuesta.query()
      .preload('moderador', (q) => q.select('id', 'nombre', 'apellido'))
      .orderBy('created_at', 'desc')
      .paginate(page, limit)

    return serialize.withoutWrapping(
      encuestas.all().map((e) => ({
        id: e.id,
        title: e.pregunta,
        author: e.moderador
          ? `${e.moderador.nombre || ''} ${e.moderador.apellido || ''}`.trim()
          : 'Admin',
        date: e.createdAt.toISO(),
        status: e.estado === 'activa' ? 'aprobada' : 'pendiente',
      }))
    )
  }

  async moderatorReports({ request, serialize }: HttpContext) {
    const page = Math.max(1, Number.parseInt(request.input('page', '1')) || 1)
    const limit = Math.min(100, Math.max(1, Number.parseInt(request.input('limit', '20')) || 20))
    const reportes = await ReporteModerador.query()
      .preload('moderador', (q) => q.select('id', 'nombre', 'apellido'))
      .preload('conductor', (q) =>
        q.select('id', 'placa').preload('usuario', (uq) => uq.select('id', 'nombre', 'apellido'))
      )
      .orderBy('created_at', 'desc')
      .paginate(page, limit)

    return serialize.withoutWrapping(
      reportes.all().map((r) => ({
        id: r.id,
        moderadorId: r.moderadorId,
        conductorId: r.conductorId,
        descripcion: r.descripcion,
        estado: r.estado,
        moderador: r.moderador
          ? { nombre: `${r.moderador.nombre || ''} ${r.moderador.apellido || ''}`.trim() }
          : null,
        conductor: r.conductor
          ? {
              placa: r.conductor.placa,
              nombre:
                `${r.conductor.usuario?.nombre || ''} ${r.conductor.usuario?.apellido || ''}`.trim(),
            }
          : null,
        createdAt: r.createdAt.toISO(),
      }))
    )
  }

  async cancellationRequests({ request, serialize }: HttpContext) {
    const page = Math.max(1, Number.parseInt(request.input('page', '1')) || 1)
    const limit = Math.min(100, Math.max(1, Number.parseInt(request.input('limit', '20')) || 20))
    const solicitudes = await SolicitudCancelacion.query()
      .where('estado', 'pendiente')
      .preload('viaje', (q) => q.select('id', 'origen_direccion', 'destino_direccion'))
      .preload('conductor', (q) => q.select('id', 'placa', 'usuario_id').preload('usuario', (uq) => uq.select('id', 'nombre', 'apellido', 'telefono')))
      .orderBy('created_at', 'desc')
      .paginate(page, limit)

    return serialize.withoutWrapping(
      solicitudes.all().map((s) => ({
        id: s.id,
        tripId: String(s.viajeId),
        conductorId: String(s.conductorId),
        motivo: s.motivo,
        estado: s.estado,
        createdAt: s.createdAt.toISO(),
        origenDireccion: s.viaje.origenDireccion,
        destinoDireccion: s.viaje.destinoDireccion,
        conductor: s.conductor
          ? {
              id: String(s.conductor.id),
              nombre:
                `${s.conductor.usuario?.nombre || ''} ${s.conductor.usuario?.apellido || ''}`.trim(),
              placa: s.conductor.placa,
              telefono: s.conductor.usuario?.telefono,
            }
          : null,
      }))
    )
  }

  async approveCancellation({ params, response, serialize }: HttpContext) {
    let solicitud = await SolicitudCancelacion.query()
      .where('id', params.id)
      .where('estado', 'pendiente')
      .preload('viaje')
      .preload('conductor', (q) => q.preload('usuario'))
      .first()

    if (!solicitud) {
      solicitud = await SolicitudCancelacion.query()
        .where('viaje_id', params.id)
        .where('estado', 'pendiente')
        .preload('viaje')
        .preload('conductor', (q) => q.preload('usuario'))
        .first()
    }

    if (!solicitud) {
      return response.status(404).send({ error: 'Solicitud de cancelación no encontrada o ya fue procesada' })
    }

    const viaje = solicitud.viaje
    if (!TripStateMachine.validarTransicion(viaje.estado as EstadoViaje, 'cancelado')) {
      return response.status(422).send({ error: `El viaje no puede cancelarse en su estado actual (${viaje.estado})` })
    }

    viaje.estado = 'cancelado'
    viaje.motivoCancelacion = `Cancelación aprobada por admin — ${solicitud.motivo}`
    viaje.canceladoAt = DateTime.now()
    await viaje.save()

    solicitud.estado = 'aprobado'
    solicitud.resueltoAt = DateTime.now()
    await solicitud.save()

    emitToClient(viaje.clienteId, 'trip:cancelled', {
      id: String(viaje.id),
      estado: viaje.estado,
      motivo: viaje.motivoCancelacion,
      canceladoPor: 'admin',
    })

    if (viaje.conductorId) {
      const conductor = await Conductor.find(viaje.conductorId)
      if (conductor) {
        emitToDriver(conductor.usuarioId, 'trip:cancelled', {
          id: String(viaje.id),
          estado: viaje.estado,
          motivo: viaje.motivoCancelacion,
          canceladoPor: 'admin',
        })
      }
    }

    return serialize.withoutWrapping({
      id: String(solicitud.id),
      estado: solicitud.estado,
      viajeId: String(viaje.id),
      viajeEstado: viaje.estado,
    })
  }

  async rejectCancellation({ params, response, serialize }: HttpContext) {
    let solicitud = await SolicitudCancelacion.query()
      .where('id', params.id)
      .where('estado', 'pendiente')
      .first()

    if (!solicitud) {
      solicitud = await SolicitudCancelacion.query()
        .where('viaje_id', params.id)
        .where('estado', 'pendiente')
        .first()
    }

    if (!solicitud) {
      return response.status(404).send({ error: 'Solicitud de cancelación no encontrada o ya fue procesada' })
    }

    solicitud.estado = 'rechazado'
    solicitud.resueltoAt = DateTime.now()
    await solicitud.save()

    return serialize.withoutWrapping({
      id: String(solicitud.id),
      estado: solicitud.estado,
    })
  }
}
