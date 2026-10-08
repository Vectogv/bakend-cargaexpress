import { DateTime } from 'luxon'
import PDFDocument from 'pdfkit'
import { randomUUID } from 'node:crypto'
import db from '@adonisjs/lucid/services/db'
import logger from '@adonisjs/core/services/logger'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import type { MultipartFile } from '@adonisjs/core/bodyparser'
import Empresa from '#models/empresa'
import Notificacion from '#models/notificacion'
import User from '#models/user'
import Viaje from '#models/viaje'
import StorageService from '#services/storage_service'
import SignedUploadService from '#services/signed_upload_service'
import { calificacionVisible } from '#services/calificacion_conductor'
import { sendToToken } from '#services/push_notification_service'
import { emitToAdmin, emitToClient } from '#start/socket'

/**
 * Cuentas de empresa (fase 1): único lugar con sus reglas.
 *
 *   • Un cliente registra la empresa (RUT + Cámara de Comercio) y queda `pendiente`
 *     hasta que el admin la aprueba o rechaza (si la rechaza, puede reenviarla).
 *   • Dueño y empleados siguen con rol cliente + `users.empresa_id`; los empleados
 *     se unen con `codigo_union` solo cuando la empresa está aprobada.
 *   • Cada viaje guarda `viajes.empresa_id` al publicarse (solo si está aprobada),
 *     así el reporte del mes no cambia si después se quita a un empleado.
 */

export class EmpresaError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string
  ) {
    super(message)
  }
}

const ZONA = 'America/Bogota'
const ARCHIVOS = { rut: 'fotoRut', camara: 'fotoCamaraComercio' } as const
type Archivos = Partial<Record<keyof typeof ARCHIVOS, MultipartFile | null>>

const nombreDe = (u?: { nombre?: string | null; apellido?: string | null } | null) =>
  `${u?.nombre || ''} ${u?.apellido || ''}`.trim()
const pesos = (n: number) => `$${Math.round(n).toLocaleString('es-CO')}`

export default class EmpresaService {
  /** Para el perfil, el login y los viajes. */
  static async empresaDe(user: User) {
    if (!user.empresaId) return null
    const e = await Empresa.find(user.empresaId)
    if (!e) return null
    return { id: e.id, nombre: e.nombre, estado: e.estadoVerificacion, esDueno: e.ownerUserId === user.id }
  }

  /** `viajes.empresa_id` al publicar: solo si la empresa del usuario está aprobada. */
  static async idAprobadaDe(user: User): Promise<number | null> {
    if (!user.empresaId) return null
    const e = await Empresa.query()
      .where('id', user.empresaId)
      .where('estado_verificacion', 'aprobado')
      .select('id')
      .first()
    return e?.id ?? null
  }

  static normalizarNit(nit: unknown): string {
    return String(nit ?? '').replace(/\D/g, '')
  }

  /** Objeto `empresa` de GET /api/empresas/mia (y de POST /api/empresas). */
  static empresaJson(e: Empresa, esDueno: boolean) {
    return {
      id: e.id,
      nombre: e.nombre,
      nit: e.nit,
      direccion: e.direccion,
      telefono: e.telefono,
      estado: e.estadoVerificacion,
      notaRechazo: e.notaRechazo,
      esDueno,
      codigo: esDueno && e.estadoVerificacion === 'aprobado' ? e.codigoUnion : null,
    }
  }

  /** 4 letras del nombre + 4 dígitos al azar, único en la tabla. */
  private static async codigoNuevo(nombre: string, trx: TransactionClientContract): Promise<string> {
    const letras = (
      nombre.normalize('NFD').replace(/[^A-Za-z]/g, '').toUpperCase().slice(0, 4) || 'EMPR'
    ).padEnd(4, 'X')
    // ponytail: 10.000 combinaciones por prefijo; si una ciudad llena un prefijo, sumar un dígito.
    for (;;) {
      const codigo = letras + String(Math.floor(Math.random() * 10000)).padStart(4, '0')
      if (!(await Empresa.query({ client: trx }).where('codigo_union', codigo).first())) return codigo
    }
  }

  private static async empresaActual(user: User): Promise<Empresa | null> {
    return user.empresaId ? Empresa.find(user.empresaId) : null
  }

  /**
   * POST /api/empresas. Primera vez: crea `pendiente` con los dos archivos.
   * Dueño de una rechazada: la reenvía (vuelve a `pendiente`, archivos opcionales).
   */
  static async registrar(
    user: User,
    datos: { nombre: string; nit: string; direccion: string | null; telefono: string | null },
    archivos: Archivos
  ): Promise<Empresa> {
    if (user.rol !== 'cliente') {
      throw new EmpresaError(403, 'SOLO_CLIENTES', 'Solo una cuenta de cliente puede registrar una empresa.')
    }
    const actual = await this.empresaActual(user)
    const reenvio = !!actual && actual.ownerUserId === user.id && actual.estadoVerificacion === 'rechazado'
    if (actual && !reenvio) {
      throw new EmpresaError(409, 'YA_TIENE_EMPRESA', 'Ya tienes una empresa registrada.')
    }
    const repetido = await Empresa.query()
      .where('nit', datos.nit)
      .if(actual, (q) => q.whereNot('id', actual!.id))
      .first()
    if (repetido) throw new EmpresaError(409, 'NIT_REPETIDO', 'Ese NIT ya está registrado.')
    if (!reenvio && (!archivos.rut || !archivos.camara)) {
      throw new EmpresaError(422, 'ARCHIVOS_REQUERIDOS', 'Sube el RUT y la Cámara de Comercio.')
    }

    const rutas: Partial<Record<'fotoRut' | 'fotoCamaraComercio', string>> = {}
    for (const campo of Object.keys(ARCHIVOS) as Array<keyof typeof ARCHIVOS>) {
      const file = archivos[campo]
      if (!file) continue
      const fileName = `empresa-${campo}-${user.id}-${randomUUID()}.${file.extname}`
      await file.move(StorageService.uploadsDir(), { name: fileName })
      rutas[ARCHIVOS[campo]] = `/storage/uploads/${fileName}`
    }

    const empresa = await db.transaction(async (trx) => {
      let e: Empresa
      if (reenvio) {
        e = actual!.useTransaction(trx)
        e.merge({ ...datos, ...rutas, estadoVerificacion: 'pendiente', notaRechazo: null })
      } else {
        e = new Empresa().useTransaction(trx)
        e.merge({
          ...datos,
          ...rutas,
          ownerUserId: user.id,
          estadoVerificacion: 'pendiente',
          codigoUnion: await this.codigoNuevo(datos.nombre, trx),
        })
      }
      await e.save()
      user.useTransaction(trx)
      user.empresaId = e.id
      await user.save()
      return e
    })

    emitToAdmin('admin:new_empresa', {
      id: empresa.id,
      nombre: empresa.nombre,
      nit: empresa.nit,
      dueno: { id: String(user.id), nombre: user.nombre, apellido: user.apellido, email: user.email },
    })
    return empresa
  }

  /** GET /api/empresas/mia. */
  static async mia(user: User) {
    const e = await this.empresaActual(user)
    if (!e) return { empresa: null }
    const esDueno = e.ownerUserId === user.id
    const aprobada = e.estadoVerificacion === 'aprobado'
    const miembros = esDueno
      ? (await User.query().where('empresa_id', e.id).select('id', 'nombre', 'apellido', 'telefono'))
          .map((m) => ({
            id: m.id,
            nombre: m.nombre,
            apellido: m.apellido,
            telefono: m.telefono,
            esDueno: m.id === e.ownerUserId,
          }))
          .sort((a, b) => Number(b.esDueno) - Number(a.esDueno) || a.id - b.id)
      : []
    return {
      empresa: this.empresaJson(e, esDueno),
      miembros,
      resumen:
        esDueno && aprobada
          ? await this.resumenMes(e.id, DateTime.now().setZone(ZONA).toFormat('yyyy-MM'))
          : null,
    }
  }

  /** La empresa del usuario si es el dueño; si no, 403. */
  static async comoDueno(user: User): Promise<Empresa> {
    const e = await this.empresaActual(user)
    if (!e || e.ownerUserId !== user.id) {
      throw new EmpresaError(403, 'NO_ES_DUENO', 'Solo el dueño de la empresa puede ver esto.')
    }
    return e
  }

  /** Viajes `finalizado` de la empresa en el mes (zona Colombia), con totales por usuario y top 3 de conductores. */
  static async resumenMes(empresaId: number, mes: string) {
    const inicio = DateTime.fromFormat(mes, 'yyyy-MM', { zone: ZONA })
    if (!inicio.isValid) throw new EmpresaError(422, 'MES_INVALIDO', 'El mes debe tener el formato YYYY-MM.')
    const fin = inicio.plus({ months: 1 })
    // La base guarda la hora en la zona del servidor: se acota por SQL con un día de
    // margen y se filtra exacto en JS (DateTime compara instantes, sin líos de zona).
    const sql = (d: DateTime) => d.toLocal().toFormat('yyyy-MM-dd HH:mm:ss')
    const viajes = (
      await Viaje.query()
        .where('empresa_id', empresaId)
        .where('estado', 'finalizado')
        .where('finalizado_at', '>=', sql(inicio.minus({ days: 1 })))
        .where('finalizado_at', '<', sql(fin.plus({ days: 1 })))
        .preload('cliente', (q) => q.select('id', 'nombre', 'apellido'))
        .preload('conductor', (q) =>
          q
            .select('id', 'usuario_id', 'calificacion', 'penalizacion_cancelacion')
            .preload('usuario', (u) => u.select('id', 'nombre', 'apellido'))
        )
        .orderBy('finalizado_at', 'desc')
    ).filter((v) => v.finalizadoAt && v.finalizadoAt >= inicio && v.finalizadoAt < fin)

    const porUsuario = new Map<number, { userId: number; nombre: string; viajes: number; total: number }>()
    const porConductor = new Map<
      number,
      { conductorId: number; nombre: string; calificacion: number; viajes: number }
    >()
    let total = 0
    for (const v of viajes) {
      const valor = Number(v.precioFinal ?? 0)
      total += valor
      const u = porUsuario.get(v.clienteId) ?? {
        userId: v.clienteId,
        nombre: nombreDe(v.cliente),
        viajes: 0,
        total: 0,
      }
      u.viajes += 1
      u.total += valor
      porUsuario.set(v.clienteId, u)
      if (v.conductor) {
        const c = porConductor.get(v.conductor.id) ?? {
          conductorId: v.conductor.id,
          nombre: nombreDe(v.conductor.usuario),
          calificacion: calificacionVisible(
            Number(v.conductor.calificacion ?? 0),
            Number(v.conductor.penalizacionCancelacion ?? 0)
          ),
          viajes: 0,
        }
        c.viajes += 1
        porConductor.set(v.conductor.id, c)
      }
    }
    return {
      mes,
      viajes: viajes.length,
      total: Math.round(total),
      porUsuario: [...porUsuario.values()]
        .map((u) => ({ ...u, total: Math.round(u.total) }))
        .sort((a, b) => b.total - a.total),
      conductores: [...porConductor.values()].sort((a, b) => b.viajes - a.viajes).slice(0, 3),
      detalle: viajes.map((v) => ({
        id: v.id,
        fecha: v.finalizadoAt!.toISO(),
        solicitante: nombreDe(v.cliente),
        origen: v.origenDireccion,
        destino: v.destinoDireccion,
        conductor: nombreDe(v.conductor?.usuario),
        valor: Math.round(Number(v.precioFinal ?? 0)),
      })),
    }
  }

  /** PDF del mes (plantilla de earningsPDF). El controlador lo manda con response.stream. */
  static reportePdf(empresa: Empresa, resumen: Awaited<ReturnType<typeof EmpresaService.resumenMes>>) {
    const doc = new PDFDocument({ margin: 50 })
    const titulo = DateTime.fromFormat(resumen.mes, 'yyyy-MM', { locale: 'es' }).toFormat('LLLL yyyy')

    doc.fontSize(18).text('CargaExpress', { align: 'center' })
    doc.fontSize(14).text(`Reporte de viajes - ${titulo}`, { align: 'center' })
    doc.moveDown()
    doc.fontSize(12).text(`Empresa: ${empresa.nombre}`)
    doc.text(`NIT: ${empresa.nit}`)
    doc.text(`Viajes: ${resumen.viajes}    Total: ${pesos(resumen.total)}`)
    doc.moveDown()
    doc.fontSize(10).text(`Generado: ${DateTime.now().setZone(ZONA).toFormat('dd/MM/yyyy HH:mm')}`)
    doc.moveDown()

    if (resumen.detalle.length === 0) {
      doc.text('No hay viajes finalizados en este mes.')
    } else {
      const top = doc.y
      doc.fontSize(9).font('Helvetica-Bold')
      doc.text('Fecha', 50, top, { width: 60 })
      doc.text('Solicitó', 110, top, { width: 90 })
      doc.text('Origen » Destino', 200, top, { width: 190 })
      doc.text('Conductor', 390, top, { width: 90 })
      doc.text('Valor', 480, top, { width: 70, align: 'right' })
      doc.moveDown()

      doc.font('Helvetica')
      let y = doc.y
      for (const v of resumen.detalle) {
        doc.text(DateTime.fromISO(v.fecha!).setZone(ZONA).toFormat('dd/MM/yy'), 50, y, { width: 60 })
        doc.text(v.solicitante, 110, y, { width: 90, ellipsis: true, height: 12 })
        doc.text(`${v.origen} » ${v.destino}`, 200, y, { width: 190, ellipsis: true, height: 12 })
        doc.text(v.conductor, 390, y, { width: 90, ellipsis: true, height: 12 })
        doc.text(pesos(v.valor), 480, y, { width: 70, align: 'right' })
        y += 18
        if (y > 700) {
          doc.addPage()
          y = 50
        }
      }

      doc.moveDown(2)
      doc.font('Helvetica-Bold').text('Totales por usuario', 50, y + 10)
      doc.font('Helvetica')
      for (const u of resumen.porUsuario) {
        doc.text(`${u.nombre}: ${u.viajes} viaje(s) · ${pesos(u.total)}`, { align: 'left' })
      }
      doc.moveDown()
      doc.font('Helvetica-Bold').text(`Total del mes: ${pesos(resumen.total)}`, { align: 'right' })
    }

    doc.end()
    return doc
  }

  /** POST /api/empresas/unirse. */
  static async unirse(user: User, codigo: unknown) {
    if (user.rol !== 'cliente') {
      throw new EmpresaError(403, 'SOLO_CLIENTES', 'Solo una cuenta de cliente puede unirse a una empresa.')
    }
    const limpio = String(codigo ?? '').trim().toUpperCase()
    const e = limpio
      ? await Empresa.query().where('codigo_union', limpio).where('estado_verificacion', 'aprobado').first()
      : null
    if (!e) throw new EmpresaError(422, 'CODIGO_INVALIDO', 'El código de empresa no existe o la empresa no está aprobada.')
    if (user.empresaId) throw new EmpresaError(409, 'YA_TIENE_EMPRESA', 'Ya perteneces a una empresa.')
    user.empresaId = e.id
    await user.save()
    return { empresa: { id: e.id, nombre: e.nombre, estado: e.estadoVerificacion, esDueno: false } }
  }

  /** POST /api/empresas/salir (el dueño no puede). */
  static async salir(user: User) {
    const e = await this.empresaActual(user)
    if (!e) throw new EmpresaError(422, 'SIN_EMPRESA', 'No perteneces a ninguna empresa.')
    if (e.ownerUserId === user.id) {
      throw new EmpresaError(422, 'ES_DUENO', 'El dueño no puede salir de su empresa.')
    }
    user.empresaId = null
    await user.save()
  }

  /** DELETE /api/empresas/miembros/:userId (solo el dueño, nunca a sí mismo). */
  static async quitarMiembro(user: User, userId: number) {
    const e = await this.comoDueno(user)
    if (userId === user.id) throw new EmpresaError(422, 'ES_DUENO', 'No puedes quitarte a ti mismo.')
    const miembro = await User.query().where('id', userId).where('empresa_id', e.id).first()
    if (!miembro) throw new EmpresaError(404, 'MIEMBRO_NO_ENCONTRADO', 'Ese usuario no es miembro de tu empresa.')
    miembro.empresaId = null
    await miembro.save()
  }

  /** GET /api/admin/empresas?estado=&page=&limit= */
  static async listaAdmin(estado: string | null, page: number, limit: number) {
    const r = await Empresa.query()
      .if(estado, (q) => q.where('estado_verificacion', estado!))
      .preload('dueno', (u) => u.select('id', 'nombre', 'apellido', 'email', 'telefono'))
      .withCount('miembros')
      .orderBy('created_at', 'asc')
      .paginate(page, limit)
    return {
      data: r.all().map((e) => ({
        id: e.id,
        nombre: e.nombre,
        nit: e.nit,
        direccion: e.direccion,
        telefono: e.telefono,
        estado: e.estadoVerificacion,
        notaRechazo: e.notaRechazo,
        codigo: e.codigoUnion,
        rut: SignedUploadService.sign(e.fotoRut),
        camara: SignedUploadService.sign(e.fotoCamaraComercio),
        dueno: e.dueno
          ? {
              id: e.dueno.id,
              nombre: e.dueno.nombre,
              apellido: e.dueno.apellido,
              email: e.dueno.email,
              telefono: e.dueno.telefono,
            }
          : null,
        miembros: Number(e.$extras.miembros_count ?? 0),
        createdAt: e.createdAt.toISO(),
      })),
      total: r.total,
      page: r.currentPage,
      limit: r.perPage,
    }
  }

  /** PUT /api/admin/empresas/:id/approve */
  static async aprobar(id: number): Promise<Empresa | null> {
    const e = await Empresa.find(id)
    if (!e) return null
    e.estadoVerificacion = 'aprobado'
    e.notaRechazo = null
    await e.save()
    await this.avisarDueno(e, 'Tu empresa fue aprobada en CargaExpress', `${e.nombre} ya está verificada. Comparte tu código con tu equipo desde Mi empresa.`)
    return e
  }

  /** PUT /api/admin/empresas/:id/reject {nota} */
  static async rechazar(id: number, nota: unknown): Promise<Empresa | null> {
    const e = await Empresa.find(id)
    if (!e) return null
    e.estadoVerificacion = 'rechazado'
    e.notaRechazo = String(nota ?? '').trim().slice(0, 500) || null
    await e.save()
    await this.avisarDueno(
      e,
      'Tu empresa no fue aprobada',
      e.notaRechazo ? `Motivo: ${e.notaRechazo}. Corrige y vuelve a enviarla desde Mi empresa.` : 'Corrige los datos y vuelve a enviarla desde Mi empresa.'
    )
    return e
  }

  private static async avisarDueno(e: Empresa, titulo: string, mensaje: string) {
    const dueno = await User.find(e.ownerUserId)
    if (!dueno) return
    const data = { tipo: 'empresa_estado', empresaId: String(e.id), estado: e.estadoVerificacion }
    await Notificacion.create({ usuarioId: dueno.id, tipo: 'empresa_estado', titulo, mensaje, leido: false })
    emitToClient(dueno.id, 'empresa:estado', data)
    if (dueno.fcmToken) {
      try {
        await sendToToken(dueno.fcmToken, titulo, mensaje, data)
      } catch (err) {
        logger.warn({ err, userId: dueno.id }, 'Push de empresa no enviado')
      }
    }
  }
}
