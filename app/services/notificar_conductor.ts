import User from '#models/user'
import Notificacion from '#models/notificacion'
import { sendToToken } from '#services/push_notification_service'
import { enviarCorreo } from '#services/mail_service'

export type AvisoConductor = {
  tipo: string
  titulo: string
  cuerpo: string
  /** Datos extra del push (la app decide qué pantalla abrir por `tipo`). */
  data?: Record<string, string>
  viajeId?: number | null
}

export type CanalesAviso = { bandeja: boolean; push: boolean; correo: boolean }

function escapar(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>')
}

/** Plantilla sencilla con la marca: cabecera azul, cuerpo y pie. */
export function plantillaCorreo(nombre: string, titulo: string, cuerpo: string) {
  return `<!doctype html><html lang="es"><body style="margin:0;background:#f4f6fb;font-family:Arial,Helvetica,sans-serif;color:#1f2937">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" style="max-width:560px;background:#fff;border-radius:12px;overflow:hidden">
<tr><td style="background:#1d4ed8;color:#fff;padding:18px 24px;font-size:18px;font-weight:bold">CargaExpress</td></tr>
<tr><td style="padding:24px"><p style="margin:0 0 12px">Hola ${escapar(nombre || 'conductor')},</p>
<h2 style="margin:0 0 12px;font-size:17px">${escapar(titulo)}</h2>
<p style="margin:0;line-height:1.5">${escapar(cuerpo)}</p></td></tr>
<tr><td style="padding:14px 24px;background:#f9fafb;color:#6b7280;font-size:12px">Este mensaje lo envió el equipo de CargaExpress desde el panel de moderación. Si tienes dudas, responde desde Soporte en la app.</td></tr>
</table></td></tr></table></body></html>`
}

/**
 * Único camino para avisar a un conductor desde el panel (moderador o admin):
 * siempre queda en la bandeja; el push y el correo son best-effort.
 */
export async function notificarConductor(usuario: User | number, aviso: AvisoConductor): Promise<CanalesAviso> {
  const u = typeof usuario === 'number' ? await User.find(usuario) : usuario
  if (!u) return { bandeja: false, push: false, correo: false }

  await Notificacion.create({
    usuarioId: u.id,
    tipo: aviso.tipo,
    titulo: aviso.titulo,
    mensaje: aviso.cuerpo,
    leido: false,
    viajeId: aviso.viajeId ?? null,
  })

  // ponytail: la bandeja ya se creó arriba; el push no debe volver a guardarla.
  const push = u.fcmToken
    ? await sendToToken(u.fcmToken, aviso.titulo, aviso.cuerpo, { tipo: aviso.tipo, ...(aviso.data || {}) }, undefined, aviso.tipo)
    : false
  const correo = u.email
    ? await enviarCorreo(u.email, `${aviso.titulo} · CargaExpress`, plantillaCorreo(u.nombre || '', aviso.titulo, aviso.cuerpo))
    : false

  return { bandeja: true, push, correo }
}
