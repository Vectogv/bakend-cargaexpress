import User from '#models/user'
import Conductor from '#models/conductor'
import Comunicado from '#models/comunicado'
import Aviso from '#models/aviso'
import ReporteModerador from '#models/reporte_moderador'
import type { HttpContext } from '@adonisjs/core/http'
import { sendToMultiple } from '#services/push_notification_service'
import { emitToAdmin, getIO } from '#start/socket'

export default class LeaderController {
  // ──────────────────────── AVISOS ────────────────────────
  async avisosIndex({ serialize }: HttpContext) {
    const posts = await Aviso.query()
      .preload('autor')
      .orderBy('fijado', 'desc')
      .orderBy('created_at', 'desc')

    return serialize.withoutWrapping(
      posts.map((p) => ({
        id: p.id,
        contenido: p.contenido,
        fijado: p.fijado,
        autor: `${p.autor.nombre} ${p.autor.apellido}`.trim(),
        createdAt: p.createdAt.toISO(),
      }))
    )
  }

  async avisosStore({ auth, request, response, serialize }: HttpContext) {
    const user = auth.getUserOrFail()
    const { contenido } = request.only(['contenido'])

    if (!contenido) {
      return response.status(422).send(serialize.withoutWrapping({ error: 'contenido es requerido' }))
    }

    const post = await Aviso.create({
      autorId: user.id,
      zona: user.zonaModerador || '',
      contenido,
      fijado: false,
    })

    return serialize.withoutWrapping({
      id: post.id,
      contenido: post.contenido,
      createdAt: post.createdAt.toISO(),
    })
  }

  async avisosPin({ params, response, serialize }: HttpContext) {
    const post = await Aviso.find(params.id)

    if (!post) {
      return response.status(404).send(serialize.withoutWrapping({ error: 'Post no encontrado' }))
    }

    post.fijado = !post.fijado
    await post.save()

    return serialize.withoutWrapping({ id: post.id, fijado: post.fijado })
  }

  async avisosDelete({ params, auth, response, serialize }: HttpContext) {
    const user = auth.getUserOrFail()
    const post = await Aviso.find(params.id)

    if (!post) {
      return response.status(404).send(serialize.withoutWrapping({ error: 'Post no encontrado' }))
    }

    if (post.autorId !== user.id) {
      return response.status(403).send(serialize.withoutWrapping({ error: 'No puedes eliminar este post' }))
    }

    await post.delete()

    return serialize.withoutWrapping({ message: 'Post eliminado' })
  }

  // ──────────────────────── COMUNICADOS ────────────────────────
  async storeComunicado({ auth, request, response, serialize }: HttpContext) {
    const user = auth.getUserOrFail()
    const { titulo, contenido } = request.only(['titulo', 'contenido'])

    if (!titulo || !contenido) {
      return response.status(422).send(serialize.withoutWrapping({ error: 'titulo y contenido son requeridos' }))
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

  async myComunicados({ auth, serialize }: HttpContext) {
    const user = auth.getUserOrFail()

    const comunicados = await Comunicado.query()
      .where('moderador_id', user.id)
      .orderBy('created_at', 'desc')

    return serialize.withoutWrapping(
      comunicados.map((c) => ({
        id: c.id,
        titulo: c.titulo,
        contenido: c.contenido,
        estado: c.estado,
        createdAt: c.createdAt.toISO(),
      }))
    )
  }

  // ──────────────────────── CONDUCTORES (lista básica) ────────────────────────
  async driversList({ request, serialize }: HttpContext) {
    const page = request.input('page', 1)
    const limit = request.input('limit', 20)

    const conductores = await Conductor.query()
      .preload('usuario', (q) => q.select('id', 'nombre', 'apellido', 'email', 'telefono'))
      .select('id', 'user_id', 'vehiculo_marca', 'vehiculo_modelo', 'vehiculo_anio', 'vehiculo_color', 'foto_url', 'puntaje', 'created_at')
      .orderBy('created_at', 'desc')
      .paginate(page, limit)

    return serialize.withoutWrapping(
      conductores.serialize()
    )
  }

  // ──────────────────────── REPORTES (limitados) ────────────────────────
  async reportsLimited({ serialize }: HttpContext) {
    const total = await ReporteModerador.query().count('*', 'total').first()
    const porTipo = await ReporteModerador.query()
      .select('tipo')
      .count('*', 'cantidad')
      .groupBy('tipo')
      .orderBy('cantidad', 'desc')

    return serialize.withoutWrapping({
      total: total?.$extras?.total ?? 0,
      porTipo,
    })
  }
}
