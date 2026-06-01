import Reporte from '#models/reporte'
import Viaje from '#models/viaje'
import Conductor from '#models/conductor'
import User from '#models/user'
import type { HttpContext } from '@adonisjs/core/http'
import { emitToAdmin } from '#start/socket'

export default class ReportController {
  async store({ auth, params, request, response }: HttpContext) {
    const user = auth.getUserOrFail()
    if (user.rol !== 'conductor') {
      return response.status(403).send({ error: 'Solo los conductores pueden reportar' })
    }

    const viaje = await Viaje.find(params.id)
    if (!viaje) {
      return response.status(404).send({ error: 'Viaje no encontrado' })
    }

    const conductor = await Conductor.findByOrFail('usuario_id', user.id)
    if (viaje.conductorId !== conductor.id) {
      return response.status(403).send({ error: 'No participaste en este viaje' })
    }

    const reporteExistente = await Reporte.query()
      .where('viaje_id', viaje.id)
      .where('conductor_id', conductor.id)
      .first()

    if (reporteExistente) {
      return response.status(400).send({ error: 'Ya has reportado este viaje' })
    }

    const { motivo, descripcion } = request.only(['motivo', 'descripcion'])
    if (!motivo || !['no_pago', 'comportamiento', 'otro'].includes(motivo)) {
      return response.status(422).send({ error: 'Motivo inválido (no_pago, comportamiento, otro)' })
    }

    const reporte = await Reporte.create({
      viajeId: viaje.id,
      conductorId: conductor.id,
      clienteId: viaje.clienteId,
      motivo,
      descripcion: descripcion || null,
      estado: 'pendiente',
    })

    const cliente = await User.find(viaje.clienteId)
    if (cliente) {
      cliente.totalReportes += 1

      if (cliente.totalReportes === 1) {
        cliente.reputacion = Math.max(1.0, cliente.reputacion - 2.0)
        cliente.visibilidad = 'reducida'
      } else {
        cliente.reputacion = 1.0
        cliente.visibilidad = 'baneado'
        cliente.suspendido = true
      }

      await cliente.save()
    }

    emitToAdmin('report:new', {
      id: String(reporte.id),
      viajeId: String(reporte.viajeId),
      conductorId: String(reporte.conductorId),
      clienteId: String(reporte.clienteId),
      motivo: reporte.motivo,
      estado: reporte.estado,
      createdAt: reporte.createdAt.toISO(),
    })

    return response.status(201).send({
      id: String(reporte.id),
      estado: reporte.estado,
      motivo: reporte.motivo,
    })
  }
}
