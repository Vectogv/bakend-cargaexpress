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
import type { HttpContext } from '@adonisjs/core/http'
import { DateTime } from 'luxon'
import app from '@adonisjs/core/services/app'
import { randomUUID } from 'node:crypto'
import { emitToDriver, emitToClient, emitToAdmin } from '#start/socket'
import { sendToMultiple } from '#services/push_notification_service'

export default class AdminController {
  async dashboard({ serialize }: HttpContext) {
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
        .whereIn('estado', ['completado', 'finalizado'])
        .where('created_at', '>=', startOfDay)
        .count('* as total')
        .first(),
      Ganancia.query().sum('monto as total').first(),
      Ganancia.query().where('created_at', '>=', startOfDay).sum('monto as total').first(),
      Ganancia.query().where('created_at', '>=', startOfMonth).sum('monto as total').first(),
    ])

    return serialize.withoutWrapping({
      totalUsers: Number(totalUsers?.$extras?.total || 0),
      totalDrivers: Number(totalDrivers?.$extras?.total || 0),
      activeVehicles: Number(activeVehicles?.$extras?.total || 0),
      todayShipments: Number(todayShipments?.$extras?.total || 0),
      totalEarnings: Number(totalEarnings?.$extras?.total || 0),
      todayEarnings: Number(todayEarnings?.$extras?.total || 0),
      monthEarnings: Number(monthEarnings?.$extras?.total || 0),
    })
  }

  async users({ serialize }: HttpContext) {
    const users = await User.query()
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
        'created_at'
      )
      .orderBy('created_at', 'desc')

    return serialize.withoutWrapping(
      users.map((u) => ({
        id: u.id,
        nombre: u.nombre,
        apellido: u.apellido,
        email: u.email,
        rol: u.rol,
        telefono: u.telefono,
        edad: u.edad,
        avatar: u.avatar,
        suspendido: u.suspendido,
        createdAt: u.createdAt?.toISO(),
      }))
    )
  }

  async drivers({ serialize }: HttpContext) {
    const drivers = await Conductor.query()
      .preload('usuario', (q) =>
        q.select('id', 'nombre', 'apellido', 'email', 'telefono', 'suspendido')
      )
      .orderBy('created_at', 'desc')

    return serialize.withoutWrapping(
      drivers.map((d) => ({
        id: d.id,
        usuarioId: d.usuarioId,
        cedula: d.cedula,
        placa: d.placa,
        tipoVehiculo: d.tipoVehiculo,
        capacidad: d.capacidad,
        online: d.online,
        calificacion: d.calificacion,
        totalViajes: d.totalViajes,
        horasActivo: d.horasActivo,
        estadoVerificacion: d.estadoVerificacion,
        fotoCedula: d.fotoCedula,
        fotoLicencia: d.fotoLicencia,
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

  async trips({ serialize }: HttpContext) {
    const trips = await Viaje.query()
      .preload('cliente', (q) => q.select('id', 'nombre', 'apellido', 'email'))
      .preload('conductor', (q) =>
        q
          .select('id', 'placa', 'tipoVehiculo')
          .preload('usuario', (uq) => uq.select('id', 'nombre', 'apellido'))
      )
      .orderBy('created_at', 'desc')

    return serialize.withoutWrapping(
      trips.map((t) => ({
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

  async earnings({ serialize }: HttpContext) {
    const all = await Ganancia.query()
      .preload('conductor', (q) =>
        q
          .select('id', 'placa')
          .preload('usuario', (uq) => uq.select('id', 'nombre', 'apellido', 'email'))
      )
      .preload('viaje', (q) => q.select('id', 'origen_direccion', 'destino_direccion', 'estado'))
      .orderBy('created_at', 'desc')

    return serialize.withoutWrapping(
      all.map((g) => ({
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
        .send(serialize.withoutWrapping({ error: 'Usuario no encontrado' }))
    }
    const data = request.only(['nombre', 'apellido', 'email', 'telefono', 'edad'])
    if (data.email && data.email !== user.email) {
      const exists = await User.findBy('email', data.email)
      if (exists) {
        return response
          .status(422)
          .send(serialize.withoutWrapping({ error: 'El email ya está en uso' }))
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

  async toggleSuspendUser({ params, response, serialize }: HttpContext) {
    const user = await User.find(params.id)
    if (!user) {
      return response
        .status(404)
        .send(serialize.withoutWrapping({ error: 'Usuario no encontrado' }))
    }
    if (user.rol === 'admin') {
      return response
        .status(403)
        .send(serialize.withoutWrapping({ error: 'No puedes suspender a otro admin' }))
    }
    user.suspendido = !user.suspendido
    await user.save()
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
        .send(serialize.withoutWrapping({ error: 'Usuario no encontrado' }))
    }
    const file = request.file('file', {
      size: '5mb',
      extnames: ['jpg', 'jpeg', 'png', 'gif', 'webp'],
    })
    if (!file) {
      return serialize.withoutWrapping({ error: 'No file uploaded' })
    }
    const fileName = `avatar-${user.id}-${randomUUID()}.${file.extname}`
    await file.move(app.makePath('storage', 'uploads'), { name: fileName })
    user.avatar = `/storage/uploads/${fileName}`
    await user.save()
    return serialize.withoutWrapping({ avatar: user.avatar })
  }

  async deleteUser({ params, response, serialize }: HttpContext) {
    const user = await User.find(params.id)
    if (!user) {
      return response
        .status(404)
        .send(serialize.withoutWrapping({ error: 'Usuario no encontrado' }))
    }
    if (user.rol === 'admin') {
      return response
        .status(403)
        .send(serialize.withoutWrapping({ error: 'No puedes eliminar a otro admin' }))
    }
    if (user.rol === 'conductor') {
      const conductor = await Conductor.findBy('usuario_id', user.id)
      if (conductor) {
        await Ganancia.query().where('conductor_id', conductor.id).delete()
        await conductor.delete()
      }
    }
    await Viaje.query().where('cliente_id', user.id).delete()
    await user.delete()
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

  async updateProfile({ auth, request, serialize }: HttpContext) {
    const user = auth.getUserOrFail()
    const data = request.only(['nombre', 'apellido', 'email', 'telefono'])
    if (data.email && data.email !== user.email) {
      const exists = await User.findBy('email', data.email)
      if (exists) {
        return serialize.withoutWrapping({ error: 'El email ya está en uso' })
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

  async uploadProfileAvatar({ auth, request, serialize }: HttpContext) {
    const user = auth.getUserOrFail()
    const file = request.file('file', {
      size: '5mb',
      extnames: ['jpg', 'jpeg', 'png', 'gif', 'webp'],
    })
    if (!file) {
      return serialize.withoutWrapping({ error: 'No file uploaded' })
    }
    const fileName = `avatar-${user.id}-${randomUUID()}.${file.extname}`
    await file.move(app.makePath('storage', 'uploads'), { name: fileName })
    user.avatar = `/storage/uploads/${fileName}`
    await user.save()
    return serialize.withoutWrapping({ avatar: user.avatar })
  }

  async conductorDebt({ serialize }: HttpContext) {
    const conductores = await Conductor.query().preload('usuario', (q) =>
      q.select('id', 'nombre', 'apellido', 'email')
    )

    const result = await Promise.all(
      conductores.map(async (c) => {
        const pendiente = await Ganancia.query()
          .where('conductor_id', c.id)
          .where('comision_pagada', false)
          .sum('comision as total')
          .first()

        const totalBruto = await Ganancia.query()
          .where('conductor_id', c.id)
          .sum('monto_bruto as total')
          .first()

        const totalNeto = await Ganancia.query()
          .where('conductor_id', c.id)
          .sum('monto_neto as total')
          .first()

        return {
          conductorId: c.id,
          nombre: `${c.usuario.nombre || ''} ${c.usuario.apellido || ''}`.trim(),
          email: c.usuario.email,
          placa: c.placa,
          totalBruto: Number(totalBruto?.$extras?.total || 0),
          totalNeto: Number(totalNeto?.$extras?.total || 0),
          comisionPendiente: Number(pendiente?.$extras?.total || 0),
        }
      })
    )

    return serialize.withoutWrapping(result.filter((r) => r.comisionPendiente > 0))
  }

  async markCommissionPaid({ params, response, serialize }: HttpContext) {
    const conductor = await Conductor.find(params.conductorId)
    if (!conductor) {
      return response
        .status(404)
        .send(serialize.withoutWrapping({ error: 'Conductor no encontrado' }))
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

  async commissionHistory({ params, response, serialize }: HttpContext) {
    const conductor = await Conductor.find(params.conductorId)
    if (!conductor) {
      return response
        .status(404)
        .send(serialize.withoutWrapping({ error: 'Conductor no encontrado' }))
    }

    const comisiones = await Ganancia.query()
      .where('conductor_id', conductor.id)
      .whereNotNull('comision')
      .preload('viaje', (q) => q.select('id', 'origen_direccion', 'destino_direccion'))
      .orderBy('created_at', 'desc')

    return serialize.withoutWrapping(
      comisiones.map((g) => ({
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

  async reports({ serialize }: HttpContext) {
    const reportes = await Reporte.query()
      .preload('cliente', (q) =>
        q.select('id', 'nombre', 'apellido', 'email', 'reputacion', 'visibilidad')
      )
      .preload('conductor', (q) =>
        q.select('id', 'placa').preload('usuario', (uq) => uq.select('id', 'nombre', 'apellido'))
      )
      .preload('viaje', (q) => q.select('id', 'origen_direccion', 'destino_direccion', 'estado'))
      .orderBy('created_at', 'desc')

    return serialize.withoutWrapping(
      reportes.map((r) => ({
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
        .send(serialize.withoutWrapping({ error: 'Reporte no encontrado' }))
    }

    reporte.estado = 'resuelto'
    await reporte.save()

    return serialize.withoutWrapping({
      id: reporte.id,
      estado: reporte.estado,
    })
  }

  async pendingVerifications({ serialize }: HttpContext) {
    const conductores = await Conductor.query()
      .where('estado_verificacion', 'pendiente')
      .preload('usuario', (q) => q.select('id', 'nombre', 'apellido', 'email', 'telefono'))
      .orderBy('created_at', 'asc')

    return serialize.withoutWrapping(
      conductores.map((c) => ({
        id: c.id,
        usuarioId: c.usuarioId,
        cedula: c.cedula,
        placa: c.placa,
        tipoVehiculo: c.tipoVehiculo,
        capacidad: c.capacidad,
        fotoCedula: c.fotoCedula,
        fotoLicencia: c.fotoLicencia,
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
        .send(serialize.withoutWrapping({ error: 'Conductor no encontrado' }))
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
        .send(serialize.withoutWrapping({ error: 'Conductor no encontrado' }))
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

  async emergencies({ serialize }: HttpContext) {
    const alertas = await AlertaEmergencia.query()
      .where('atendida', false)
      .preload('usuario', (q) => q.select('id', 'nombre', 'apellido', 'telefono'))
      .preload('viaje')
      .orderBy('created_at', 'desc')

    return serialize.withoutWrapping(
      alertas.map((a) => ({
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
              origen: a.viaje.origenDireccion,
              destino: a.viaje.destinoDireccion,
              estado: a.viaje.estado,
            }
          : null,
        createdAt: a.createdAt.toISO(),
      }))
    )
  }

  async resolveEmergency({ params, response, serialize }: HttpContext) {
    const alerta = await AlertaEmergencia.find(params.id)
    if (!alerta) {
      return response.status(404).send(serialize.withoutWrapping({ error: 'Alerta no encontrada' }))
    }

    alerta.atendida = true
    await alerta.save()

    return serialize.withoutWrapping({
      id: alerta.id,
      atendida: alerta.atendida,
    })
  }

  async disputes({ serialize }: HttpContext) {
    const disputas = await Disputa.query()
      .whereIn('estado', ['abierta', 'en_revision'])
      .preload('viaje')
      .preload('conductor', (q) => q.preload('usuario'))
      .preload('cliente')
      .orderBy('created_at', 'desc')

    return serialize.withoutWrapping(
      disputas.map((d) => ({
        id: d.id,
        viajeId: d.viajeId,
        conductorId: d.conductorId,
        clienteId: d.clienteId,
        versionConductor: d.versionConductor,
        versionCliente: d.versionCliente,
        soporteCliente: d.soporteCliente,
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

  async resolveDispute({ params, request, response, serialize }: HttpContext) {
    const disputa = await Disputa.find(params.id)
    if (!disputa) {
      return response
        .status(404)
        .send(serialize.withoutWrapping({ error: 'Disputa no encontrada' }))
    }
    if (disputa.estado === 'resuelta') {
      return response
        .status(400)
        .send(serialize.withoutWrapping({ error: 'La disputa ya fue resuelta' }))
    }

    const { resultado, acuerdoDePago, montoDeuda } = request.only([
      'resultado',
      'acuerdoDePago',
      'montoDeuda',
    ])
    if (!['favor_conductor', 'favor_cliente'].includes(resultado)) {
      return response.status(422).send(
        serialize.withoutWrapping({
          error: 'Resultado inválido (favor_conductor, favor_cliente)',
        })
      )
    }

    disputa.estado = 'resuelta'
    disputa.resultado = resultado
    disputa.resueltaAt = DateTime.now()
    await disputa.save()

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
        message: 'La disputa se resolvió a tu favor.',
      })
    }

    return serialize.withoutWrapping({
      id: disputa.id,
      estado: disputa.estado,
      resultado: disputa.resultado,
      resueltaAt: disputa.resueltaAt?.toISO(),
    })
  }

  async clearDebt({ params, response, serialize }: HttpContext) {
    const user = await User.find(params.id)
    if (!user) {
      return response
        .status(404)
        .send(serialize.withoutWrapping({ error: 'Usuario no encontrado' }))
    }
    user.tieneDeudaActiva = false
    user.estadoCuenta = 'activa'
    user.montoDeuda = null
    user.deudaFechaLimite = null
    user.comprobantePago = null
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
        'created_at'
      )

    return serialize.withoutWrapping(
      usuarios.map((u) => ({
        id: u.id,
        nombre: `${u.nombre} ${u.apellido}`.trim(),
        email: u.email,
        montoDeuda: u.montoDeuda,
        deudaFechaLimite: u.deudaFechaLimite?.toISO() || null,
        comprobante: u.comprobantePago,
        createdAt: u.createdAt.toISO(),
      }))
    )
  }

  async confirmPayment({ params, response, serialize }: HttpContext) {
    const user = await User.find(params.userId)
    if (!user) {
      return response
        .status(404)
        .send(serialize.withoutWrapping({ error: 'Usuario no encontrado' }))
    }
    if (user.estadoCuenta !== 'esperando_confirmacion') {
      return response
        .status(422)
        .send(serialize.withoutWrapping({ error: 'El usuario no tiene un comprobante pendiente' }))
    }

    user.tieneDeudaActiva = false
    user.estadoCuenta = 'activa'
    user.montoDeuda = null
    user.deudaFechaLimite = null
    user.comprobantePago = null
    await user.save()

    emitToClient(user.id, 'payment:confirmed', {
      message: 'Tu pago ha sido confirmado. Tu cuenta está activa nuevamente.',
    })

    return serialize.withoutWrapping({
      id: user.id,
      estadoCuenta: user.estadoCuenta,
      message: 'Pago confirmado. Cuenta reactivada.',
    })
  }

  async rejectPayment({ params, response, serialize }: HttpContext) {
    const user = await User.find(params.userId)
    if (!user) {
      return response
        .status(404)
        .send(serialize.withoutWrapping({ error: 'Usuario no encontrado' }))
    }
    if (user.estadoCuenta !== 'esperando_confirmacion') {
      return response
        .status(422)
        .send(serialize.withoutWrapping({ error: 'El usuario no tiene un comprobante pendiente' }))
    }

    user.estadoCuenta = 'suspension_por_pago'
    user.comprobantePago = null
    await user.save()

    const diasRestantes = user.deudaFechaLimite
      ? Math.ceil(user.deudaFechaLimite.diff(DateTime.now(), 'days').days)
      : 0

    emitToClient(user.id, 'payment:rejected', {
      message: `Tu comprobante no fue válido. Te quedan ${diasRestantes} días para pagar.`,
      diasRestantes,
    })

    return serialize.withoutWrapping({
      id: user.id,
      estadoCuenta: user.estadoCuenta,
      message: 'Pago rechazado. El usuario vuelve a suspensión por pago.',
    })
  }

  async updateConfig({ request, serialize }: HttpContext) {
    let config = await ConfiguracionPlataforma.first()
    if (!config) {
      config = await ConfiguracionPlataforma.create({})
    }

    const { nequiNumero, nequiNombre } = request.only(['nequiNumero', 'nequiNombre'])
    if (nequiNumero !== undefined) config.nequiNumero = nequiNumero
    if (nequiNombre !== undefined) config.nequiNombre = nequiNombre
    await config.save()

    return serialize.withoutWrapping({
      nequiNumero: config.nequiNumero,
      nequiNombre: config.nequiNombre,
    })
  }

  async updateCoverage({ request, response, serialize }: HttpContext) {
    let config = await ConfiguracionPlataforma.first()
    if (!config) {
      config = await ConfiguracionPlataforma.create({})
    }

    const { zonasCobertura } = request.only(['zonasCobertura'])
    if (!zonasCobertura || !Array.isArray(zonasCobertura)) {
      return response
        .status(422)
        .send(serialize.withoutWrapping({ error: 'zonasCobertura debe ser un array' }))
    }
    config.zonasCobertura = zonasCobertura
    await config.save()

    return serialize.withoutWrapping({ zonasCobertura: config.zonasCobertura })
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

  async updateBanner({ request, serialize }: HttpContext) {
    let config = await ConfiguracionPlataforma.first()
    if (!config) {
      config = await ConfiguracionPlataforma.create({})
    }

    const file = request.file('banner_imagen', {
      size: '2mb',
      extnames: ['jpg', 'jpeg', 'png', 'gif', 'webp'],
    })

    if (file) {
      const fileName = `banner-${randomUUID()}.${file.extname}`
      await file.move(app.makePath('storage', 'uploads'), { name: fileName })
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
        .send(serialize.withoutWrapping({ error: 'Usuario no encontrado' }))
    }

    const { esModerador, zonaModerador } = request.only(['esModerador', 'zonaModerador'])
    if (esModerador !== undefined) {
      user.esModerador = esModerador === true || esModerador === 'true'
    }
    if (zonaModerador !== undefined) {
      if (zonaModerador && !['cali', 'popayan', 'pasto'].includes(zonaModerador)) {
        return response
          .status(422)
          .send(serialize.withoutWrapping({ error: 'Zona inválida (cali, popayan, pasto)' }))
      }
      user.zonaModerador = zonaModerador || null
    }
    await user.save()

    return serialize.withoutWrapping({
      id: user.id,
      esModerador: user.esModerador,
      zonaModerador: user.zonaModerador,
    })
  }

  async approveComunicado({ params, response, serialize }: HttpContext) {
    const comunicado = await Comunicado.find(params.id)
    if (!comunicado) {
      return response
        .status(404)
        .send(serialize.withoutWrapping({ error: 'Comunicado no encontrado' }))
    }
    if (comunicado.estado !== 'pendiente') {
      return response
        .status(422)
        .send(serialize.withoutWrapping({ error: 'El comunicado ya fue procesado' }))
    }

    comunicado.estado = 'aprobado'
    comunicado.publicadoAt = DateTime.now()
    await comunicado.save()

    const conductores = await Conductor.query()
      .whereHas('usuario', (q) => q.whereNotNull('fcm_token'))
      .preload('usuario')
    const tokens = conductores.map((c) => c.usuario.fcmToken).filter(Boolean) as string[]

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
        .send(serialize.withoutWrapping({ error: 'Comunicado no encontrado' }))
    }
    if (comunicado.estado !== 'pendiente') {
      return response
        .status(422)
        .send(serialize.withoutWrapping({ error: 'El comunicado ya fue procesado' }))
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
        .send(serialize.withoutWrapping({ error: 'Encuesta no encontrada' }))
    }
    if (encuesta.estado !== 'pendiente') {
      return response
        .status(422)
        .send(serialize.withoutWrapping({ error: 'La encuesta ya fue procesada' }))
    }

    encuesta.estado = 'activa'
    await encuesta.save()

    const conductores = await Conductor.query()
      .whereHas('usuario', (q) => q.whereNotNull('fcm_token'))
      .preload('usuario')
    const tokens = conductores.map((c) => c.usuario.fcmToken).filter(Boolean) as string[]

    if (tokens.length > 0) {
      await sendToMultiple(tokens, 'Nueva encuesta disponible', encuesta.pregunta)
    }

    return serialize.withoutWrapping({
      id: encuesta.id,
      estado: encuesta.estado,
    })
  }

  async moderatorReports({ serialize }: HttpContext) {
    const reportes = await ReporteModerador.query()
      .preload('moderador', (q) => q.select('id', 'nombre', 'apellido'))
      .preload('conductor', (q) =>
        q.select('id', 'placa').preload('usuario', (uq) => uq.select('id', 'nombre', 'apellido'))
      )
      .orderBy('created_at', 'desc')

    return serialize.withoutWrapping(
      reportes.map((r) => ({
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
}
