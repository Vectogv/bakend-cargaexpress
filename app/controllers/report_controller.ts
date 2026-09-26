import Reporte from '#models/reporte'
import Viaje from '#models/viaje'
import Conductor from '#models/conductor'
import User from '#models/user'
import type { HttpContext } from '@adonisjs/core/http'
import { emitToAdmin } from '#start/socket'

/** Motivos válidos según quién reporta. */
const MOTIVOS = {
  conductor: ['no_pago', 'comportamiento', 'otro'],
  cliente: ['no_se_presento', 'cobro_incorrecto', 'comportamiento', 'otro'],
} as const

type Reportante = keyof typeof MOTIVOS

/**
 * POST /api/trips/:id/report. El rol del usuario autenticado decide la
 * dirección: el conductor asignado reporta al cliente del viaje y el cliente
 * dueño del viaje reporta al conductor asignado. Las reglas son las mismas en
 * ambos sentidos.
 */
export default class ReportController {
  async store(ctx: HttpContext) {
    const { auth, params, response } = ctx
    const user = auth.getUserOrFail()

    if (user.rol !== 'conductor' && user.rol !== 'cliente') {
      return response.status(403).send({ error: 'Solo conductores y clientes pueden reportar' })
    }

    const viaje = await Viaje.find(params.id)
    if (!viaje) {
      return response.status(404).send({ error: 'Viaje no encontrado' })
    }

    return user.rol === 'conductor'
      ? this.reportarCliente(ctx, user, viaje)
      : this.reportarConductor(ctx, user, viaje)
  }

  /** Conductor asignado → cliente del viaje. */
  private async reportarCliente({ request, response }: HttpContext, user: User, viaje: Viaje) {
    const conductor = await Conductor.findByOrFail('usuario_id', user.id)
    if (viaje.conductorId !== conductor.id) {
      return response.status(403).send({ error: 'No participaste en este viaje' })
    }

    const reporteExistente = await Reporte.query()
      .where('viaje_id', viaje.id)
      .where('conductor_id', conductor.id)
      .where('reportado_por', 'conductor')
      .first()

    if (reporteExistente) {
      return response.status(400).send({ error: 'Ya has reportado este viaje' })
    }

    const datos = this.validarDatos(request, 'conductor')
    if ('error' in datos) {
      return response.status(422).send({ error: datos.error })
    }

    const reporte = await Reporte.create({
      viajeId: viaje.id,
      conductorId: conductor.id,
      clienteId: viaje.clienteId,
      motivo: datos.motivo,
      descripcion: datos.descripcion,
      estado: 'pendiente',
      reportadoPor: 'conductor',
    })

    const cliente = await User.find(viaje.clienteId)
    const requiereRevision = await this.penalizar(cliente)
    this.avisarAdmin(reporte, requiereRevision)

    return response.status(201).send(this.respuesta(reporte))
  }

  /** Cliente dueño del viaje → conductor asignado. */
  private async reportarConductor({ request, response }: HttpContext, user: User, viaje: Viaje) {
    if (viaje.clienteId !== user.id) {
      return response.status(403).send({ error: 'Este viaje no es tuyo' })
    }

    if (!viaje.conductorId) {
      return response.status(422).send({ error: 'El viaje no tuvo conductor asignado' })
    }

    const reporteExistente = await Reporte.query()
      .where('viaje_id', viaje.id)
      .where('cliente_id', user.id)
      .where('reportado_por', 'cliente')
      .first()

    if (reporteExistente) {
      return response.status(409).send({ error: 'Ya reportaste al conductor de este viaje' })
    }

    const datos = this.validarDatos(request, 'cliente')
    if ('error' in datos) {
      return response.status(422).send({ error: datos.error })
    }

    const reporte = await Reporte.create({
      viajeId: viaje.id,
      conductorId: viaje.conductorId,
      clienteId: user.id,
      motivo: datos.motivo,
      descripcion: datos.descripcion,
      estado: 'pendiente',
      reportadoPor: 'cliente',
    })

    // La reputación y la visibilidad del conductor viven en su User.
    const conductor = await Conductor.find(viaje.conductorId)
    const usuarioConductor = conductor ? await User.find(conductor.usuarioId) : null
    const requiereRevision = await this.penalizar(usuarioConductor)
    this.avisarAdmin(reporte, requiereRevision)

    return response.status(201).send(this.respuesta(reporte))
  }

  private validarDatos(
    request: HttpContext['request'],
    reportante: Reportante
  ): { motivo: string; descripcion: string | null } | { error: string } {
    const { motivo, descripcion } = request.only(['motivo', 'descripcion'])
    const validos: readonly string[] = MOTIVOS[reportante]
    if (!motivo || !validos.includes(motivo)) {
      return { error: `Motivo inválido (${validos.join(', ')})` }
    }
    return { motivo, descripcion: descripcion || null }
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

  private respuesta(reporte: Reporte) {
    return {
      id: String(reporte.id),
      estado: reporte.estado,
      motivo: reporte.motivo,
      reportadoPor: reporte.reportadoPor,
    }
  }
}
