import Reporte from '#models/reporte'
import Viaje from '#models/viaje'
import Conductor from '#models/conductor'
import User from '#models/user'
import type { HttpContext } from '@adonisjs/core/http'
import { emitToAdmin } from '#start/socket'
import { DateTime } from 'luxon'

/** Motivos válidos para el conductor. */
const MOTIVOS = ['no_pago', 'comportamiento', 'otro'] as const

/** Plazo para reportar un viaje, contado desde su cierre. */
export const REPORTE_PLAZO_MIN = 30

/**
 * POST /api/trips/:id/report. Solo el conductor asignado reporta al cliente
 * del viaje, y solo con el viaje finalizado y dentro de REPORTE_PLAZO_MIN
 * minutos desde el cierre (el cliente ya no reporta desde la app).
 */
export default class ReportController {
  async store({ auth, params, request, response }: HttpContext) {
    const user = auth.getUserOrFail()

    if (user.rol !== 'conductor') {
      return response.status(403).send({ message: 'Solo el conductor puede reportar el viaje' })
    }

    const viaje = await Viaje.find(params.id)
    if (!viaje) {
      return response.status(404).send({ error: 'Viaje no encontrado' })
    }

    const conductor = await Conductor.findByOrFail('usuario_id', user.id)
    if (viaje.conductorId !== conductor.id) {
      return response.status(403).send({ error: 'No participaste en este viaje' })
    }

    if (viaje.estado !== 'finalizado') {
      return response.status(422).send({ message: 'Solo puedes reportar viajes finalizados' })
    }

    const cierre = viaje.finalizadoAt ?? viaje.completadoAt ?? viaje.createdAt
    if (DateTime.now() > cierre.plus({ minutes: REPORTE_PLAZO_MIN })) {
      return response.status(422).send({
        message: `El plazo para reportar este viaje ya venció (${REPORTE_PLAZO_MIN} minutos)`,
      })
    }

    const reporteExistente = await Reporte.query()
      .where('viaje_id', viaje.id)
      .where('conductor_id', conductor.id)
      .where('reportado_por', 'conductor')
      .first()

    if (reporteExistente) {
      return response.status(400).send({ error: 'Ya has reportado este viaje' })
    }

    const { motivo, descripcion } = request.only(['motivo', 'descripcion'])
    if (!motivo || !(MOTIVOS as readonly string[]).includes(motivo)) {
      return response.status(422).send({ error: `Motivo inválido (${MOTIVOS.join(', ')})` })
    }

    const reporte = await Reporte.create({
      viajeId: viaje.id,
      conductorId: conductor.id,
      clienteId: viaje.clienteId,
      motivo,
      descripcion: descripcion || null,
      estado: 'pendiente',
      reportadoPor: 'conductor',
    })

    const cliente = await User.find(viaje.clienteId)
    const requiereRevision = await this.penalizar(cliente)
    this.avisarAdmin(reporte, requiereRevision)

    return response.status(201).send({
      id: String(reporte.id),
      estado: reporte.estado,
      motivo: reporte.motivo,
      reportadoPor: reporte.reportadoPor,
    })
  }

  /**
   * Los reportes NUNCA suspenden automáticamente: solo bajan la reputación y
   * la visibilidad. A partir del 2º reporte la cuenta queda marcada para que
   * un admin la revise y decida si suspende con PUT /admin/users/:id/suspend.
   * Devuelve si la cuenta requiere revisión.
   */
  private async penalizar(reportado: User | null): Promise<boolean> {
    if (!reportado) return false

    reportado.totalReportes += 1
    reportado.visibilidad = 'reducida'

    if (reportado.totalReportes === 1) {
      reportado.reputacion = Math.max(1.0, reportado.reputacion - 2.0)
    } else {
      reportado.reputacion = 1.0
    }

    await reportado.save()
    return reportado.totalReportes >= 2
  }

  private avisarAdmin(reporte: Reporte, requiereRevision: boolean) {
    emitToAdmin('report:new', {
      id: String(reporte.id),
      viajeId: String(reporte.viajeId),
      conductorId: String(reporte.conductorId),
      clienteId: String(reporte.clienteId),
      motivo: reporte.motivo,
      estado: reporte.estado,
      reportadoPor: reporte.reportadoPor,
      createdAt: reporte.createdAt.toISO(),
      requiereRevision,
    })
  }
}
