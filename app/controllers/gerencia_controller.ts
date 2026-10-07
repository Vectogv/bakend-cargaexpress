import type { HttpContext } from '@adonisjs/core/http'
import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'
import Aviso from '#models/aviso'
import Notificacion from '#models/notificacion'
import antifraudeConfig from '#config/antifraude'
import { claveDe } from '#services/coverage_service'
import { sendToMultiple } from '#services/push_notification_service'

const SIN_ZONA = 'sin_zona'

export default class GerenciaController {
  /**
   * Gerencia envía una comunicación propia a los conductores o a los moderadores,
   * de una zona o de todas. Queda en la bandeja de cada destinatario, los conductores
   * la ven además como aviso del grupo de su zona ('general' si es para todos), y va
   * con push.
   */
  async comunicar({ auth, request, response, serialize }: HttpContext) {
    const admin = auth.getUserOrFail()
    const { titulo, mensaje, destino, zona } = request.only(['titulo', 'mensaje', 'destino', 'zona'])
    const t = String(titulo ?? '').trim()
    const m = String(mensaje ?? '').trim()
    if (!t || t.length > 100 || !m || m.length > 1000) {
      return response.status(422).send(
        await serialize.withoutWrapping({ error: 'Título (máx. 100) y mensaje (máx. 1000) son obligatorios' })
      )
    }
    if (!['conductores', 'moderadores'].includes(destino)) {
      return response
        .status(422)
        .send(await serialize.withoutWrapping({ error: 'destino debe ser conductores o moderadores' }))
    }
    const clave = zona && String(zona).trim() ? claveDe(String(zona)) : null

    // ponytail: filtra la zona en JS (la ciudad es texto libre); indexar si crecen mucho los usuarios.
    const filas: any[] =
      destino === 'conductores'
        ? await db
            .from('conductores')
            .join('users', 'users.id', 'conductores.usuario_id')
            .select('users.id', 'conductores.ciudad as zona', 'users.fcm_token')
        : await db.from('users').where('es_moderador', true).select('id', 'zona_moderador as zona', 'fcm_token')
    const destinatarios = filas
      .map((f) => ({ id: f.id as number, zona: f.zona ? claveDe(f.zona) : null, token: f.fcm_token as string | null }))
      .filter((f) => !clave || f.zona === clave)

    if (destino === 'conductores') {
      await Aviso.create({ autorId: admin.id, zona: clave ?? 'general', contenido: `${t}\n\n${m}`, fijado: false })
    }
    for (const d of destinatarios) {
      await Notificacion.create({
        usuarioId: d.id,
        tipo: 'comunicado_gerencia',
        titulo: t,
        mensaje: m,
        leido: false,
      })
    }
    const tokens = destinatarios.map((d) => d.token).filter((x): x is string => !!x)
    await sendToMultiple(tokens, t, m, { tipo: 'comunicado_gerencia' })

    return serialize.withoutWrapping({
      destino,
      zona: clave ?? 'todas',
      destinatarios: destinatarios.length,
      conPush: tokens.length,
    })
  }

  /**
   * Todo lo pendiente de revisar, por categoría y zona (?zona= filtra).
   * Cada categoría: total, porZona y las 5 más antiguas (las que más llevan esperando).
   */
  async pendientes({ request, serialize }: HttpContext) {
    const filtro = request.input('zona') ? claveDe(String(request.input('zona'))) : null
    const zonaDe = (ciudad: string | null | undefined) => (ciudad ? claveDe(ciudad) || SIN_ZONA : SIN_ZONA)

    const conductores = await db.from('conductores').select('id', 'ciudad')
    const zonaConductor = new Map<number, string>(conductores.map((c: any) => [c.id, zonaDe(c.ciudad)]))
    const zonaPorConductor = (id: number | null) => (id ? (zonaConductor.get(id) ?? SIN_ZONA) : SIN_ZONA)

    type Item = { id: number; titulo: string; zona: string; createdAt: string | null }
    const nombre = (n?: string | null, a?: string | null) => `${n || ''} ${a || ''}`.trim()
    const iso = (v: any) => (v ? DateTime.fromJSDate(new Date(v)).toISO() : null)
    const categorias: {
      clave: string
      titulo: string
      total: number
      porZona: Record<string, number>
      items: Item[]
    }[] = []
    const agregar = (clave: string, titulo: string, todos: Item[]) => {
      const items = (filtro ? todos.filter((i) => i.zona === filtro) : todos).sort((a, b) =>
        String(a.createdAt).localeCompare(String(b.createdAt))
      )
      const porZona: Record<string, number> = {}
      for (const i of items) porZona[i.zona] = (porZona[i.zona] ?? 0) + 1
      categorias.push({ clave, titulo, total: items.length, porZona, items: items.slice(0, 5) })
    }
    const conductorUsuario = (q: any) =>
      q
        .from('conductores')
        .join('users', 'users.id', 'conductores.usuario_id')
        .select('conductores.id', 'conductores.ciudad', 'conductores.created_at', 'users.nombre', 'users.apellido')
    const deConductor = (v: any): Item => ({
      id: v.id,
      titulo: nombre(v.nombre, v.apellido),
      zona: zonaDe(v.ciudad),
      createdAt: iso(v.created_at),
    })

    agregar(
      'verificaciones',
      'Verificaciones de conductores',
      (await conductorUsuario(db).where('conductores.estado_verificacion', 'pendiente')).map(deConductor)
    )
    agregar(
      'soat',
      'Excepciones de SOAT',
      (await conductorUsuario(db).where('conductores.excepcion_soat_estado', 'pendiente')).map(deConductor)
    )

    const porViaje = (rows: any[], fecha = 'created_at'): Item[] =>
      rows.map((r) => ({
        id: r.id,
        titulo: `Viaje #${r.viaje_id ?? r.id}`,
        zona: zonaPorConductor(r.conductor_id),
        createdAt: iso(r[fecha]),
      }))

    agregar(
      'disputas',
      'Disputas abiertas',
      porViaje(await db.from('disputas').whereIn('estado', ['abierta', 'en_revision']).select('id', 'viaje_id', 'conductor_id', 'created_at'))
    )

    const corte = DateTime.now().minus({ minutes: antifraudeConfig.confirmacionTimeoutMin }).toSQL()!
    agregar(
      'cierres',
      'Cierres sin confirmar del cliente',
      porViaje(
        await db
          .from('viajes')
          .where('estado', 'pendiente_confirmacion')
          .whereNotNull('pendiente_confirmacion_desde')
          .where('pendiente_confirmacion_desde', '<', corte)
          .select('id', 'conductor_id', 'pendiente_confirmacion_desde'),
        'pendiente_confirmacion_desde'
      )
    )

    agregar(
      'cancelaciones',
      'Solicitudes de cancelación',
      porViaje(await db.from('solicitudes_cancelacion').where('estado', 'pendiente').select('id', 'viaje_id', 'conductor_id', 'created_at'))
    )

    agregar(
      'tickets',
      'Tickets de soporte',
      (await db.from('tickets_soporte').whereIn('estado', ['abierto', 'en_proceso']).select('id', 'asunto', 'zona', 'created_at')).map(
        (t: any) => ({ id: t.id, titulo: t.asunto, zona: zonaDe(t.zona), createdAt: iso(t.created_at) })
      )
    )

    const emergencias = await db
      .from('alertas_emergencia')
      .where((w) => w.where('estado', 'atendida').orWhere((p) => p.where('estado', 'pendiente').where('atendida', false)))
      .select('id', 'viaje_id', 'created_at')
    const conductorDeViaje = new Map<number, number | null>()
    const viajeIds = emergencias.map((e: any) => e.viaje_id).filter(Boolean)
    if (viajeIds.length) {
      for (const v of await db.from('viajes').whereIn('id', viajeIds).select('id', 'conductor_id')) {
        conductorDeViaje.set(v.id, v.conductor_id)
      }
    }
    agregar(
      'emergencias',
      'Emergencias (SOS)',
      emergencias.map((e: any) => ({
        id: e.id,
        titulo: e.viaje_id ? `Viaje #${e.viaje_id}` : 'SOS sin viaje',
        zona: zonaPorConductor(conductorDeViaje.get(e.viaje_id) ?? null),
        createdAt: iso(e.created_at),
      }))
    )

    agregar(
      'reportes',
      'Reportes de viajes',
      porViaje(await db.from('reportes').where('estado', 'pendiente').select('id', 'viaje_id', 'conductor_id', 'created_at'))
    )

    agregar(
      'comunicados',
      'Comunicados de líderes por aprobar',
      (await db.from('comunicados').where('estado', 'pendiente').select('id', 'titulo', 'zona', 'created_at')).map((c: any) => ({
        id: c.id,
        titulo: c.titulo,
        zona: zonaDe(c.zona),
        createdAt: iso(c.created_at),
      }))
    )

    const pagos = await db
      .from('users')
      .where('estado_cuenta', 'esperando_confirmacion')
      .whereNotNull('comprobante_pago')
      .select('id', 'nombre', 'apellido', 'comprobante_subido_at', 'created_at')
    const zonaDeUsuario = new Map<number, string>()
    if (pagos.length) {
      const cs = await db.from('conductores').whereIn('usuario_id', pagos.map((p: any) => p.id)).select('usuario_id', 'ciudad')
      for (const c of cs) zonaDeUsuario.set(c.usuario_id, zonaDe(c.ciudad))
    }
    agregar(
      'pagos',
      'Comprobantes de pago',
      pagos.map((p: any) => ({
        id: p.id,
        titulo: nombre(p.nombre, p.apellido),
        zona: zonaDeUsuario.get(p.id) ?? SIN_ZONA,
        createdAt: iso(p.comprobante_subido_at ?? p.created_at),
      }))
    )

    return serialize.withoutWrapping({
      total: categorias.reduce((s, c) => s + c.total, 0),
      categorias,
    })
  }
}
