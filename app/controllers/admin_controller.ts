import User from '#models/user'
import Conductor from '#models/conductor'
import Ganancia from '#models/ganancia'
import Viaje from '#models/viaje'
import type { HttpContext } from '@adonisjs/core/http'
import { DateTime } from 'luxon'
import app from '@adonisjs/core/services/app'
import { randomUUID } from 'node:crypto'

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
      .select('id', 'nombre', 'apellido', 'email', 'rol', 'telefono', 'edad', 'avatar', 'suspendido', 'created_at')
      .orderBy('created_at', 'desc')

    return serialize.withoutWrapping(users.map(u => ({
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
    })))
  }

  async drivers({ serialize }: HttpContext) {
    const drivers = await Conductor.query()
      .preload('usuario', (q) => q.select('id', 'nombre', 'apellido', 'email', 'telefono', 'suspendido'))
      .orderBy('created_at', 'desc')

    return serialize.withoutWrapping(drivers.map(d => ({
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
      fotoConductor: d.fotoConductor,
      fotoVehiculo: d.fotoVehiculo,
      usuario: d.usuario ? {
        nombre: d.usuario.nombre,
        apellido: d.usuario.apellido,
        email: d.usuario.email,
        telefono: d.usuario.telefono,
        suspendido: d.usuario.suspendido,
      } : null,
      createdAt: d.createdAt.toISO(),
    })))
  }

  async trips({ serialize }: HttpContext) {
    const trips = await Viaje.query()
      .preload('cliente', (q) => q.select('id', 'nombre', 'apellido', 'email'))
      .preload('conductor', (q) => q.select('id', 'placa', 'tipoVehiculo').preload('usuario', (uq) => uq.select('id', 'nombre', 'apellido')))
      .orderBy('created_at', 'desc')

    return serialize.withoutWrapping(trips.map(t => ({
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
      cliente: t.cliente ? {
        nombre: t.cliente.nombre,
        apellido: t.cliente.apellido,
        email: t.cliente.email,
      } : null,
      conductor: t.conductor ? {
        placa: t.conductor.placa,
        tipoVehiculo: t.conductor.tipoVehiculo,
        nombre: t.conductor.usuario?.nombre,
        apellido: t.conductor.usuario?.apellido,
      } : null,
      createdAt: t.createdAt.toISO(),
      aceptadoAt: t.aceptadoAt?.toISO() ?? null,
      completadoAt: t.completadoAt?.toISO() ?? null,
      finalizadoAt: t.finalizadoAt?.toISO() ?? null,
      canceladoAt: t.canceladoAt?.toISO() ?? null,
      enCursoAt: t.enCursoAt?.toISO() ?? null,
    })))
  }

  async earnings({ serialize }: HttpContext) {
    const all = await Ganancia.query()
      .preload('conductor', (q) => q.select('id', 'placa').preload('usuario', (uq) => uq.select('id', 'nombre', 'apellido', 'email')))
      .preload('viaje', (q) => q.select('id', 'origen_direccion', 'destino_direccion', 'estado'))
      .orderBy('created_at', 'desc')

    return serialize.withoutWrapping(all.map(g => ({
      id: g.id,
      monto: g.monto,
      conductorId: g.conductorId,
      viajeId: g.viajeId,
      conductor: g.conductor ? {
        placa: g.conductor.placa,
        nombre: g.conductor.usuario?.nombre,
        apellido: g.conductor.usuario?.apellido,
        email: g.conductor.usuario?.email,
      } : null,
      viaje: g.viaje ? {
        origen: g.viaje.origenDireccion,
        destino: g.viaje.destinoDireccion,
        estado: g.viaje.estado,
      } : null,
      createdAt: g.createdAt.toISO(),
    })))
  }

  async updateUser({ params, request, response, serialize }: HttpContext) {
    const user = await User.find(params.id)
    if (!user) {
      return response.status(404).send(serialize.withoutWrapping({ error: 'Usuario no encontrado' }))
    }
    const data = request.only(['nombre', 'apellido', 'email', 'telefono', 'edad'])
    if (data.email && data.email !== user.email) {
      const exists = await User.findBy('email', data.email)
      if (exists) {
        return response.status(422).send(serialize.withoutWrapping({ error: 'El email ya está en uso' }))
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
      return response.status(404).send(serialize.withoutWrapping({ error: 'Usuario no encontrado' }))
    }
    if (user.rol === 'admin') {
      return response.status(403).send(serialize.withoutWrapping({ error: 'No puedes suspender a otro admin' }))
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
      return response.status(404).send(serialize.withoutWrapping({ error: 'Usuario no encontrado' }))
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
      return response.status(404).send(serialize.withoutWrapping({ error: 'Usuario no encontrado' }))
    }
    if (user.rol === 'admin') {
      return response.status(403).send(serialize.withoutWrapping({ error: 'No puedes eliminar a otro admin' }))
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
}
