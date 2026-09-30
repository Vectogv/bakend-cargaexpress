import env from '#start/env'
import logger from '@adonisjs/core/services/logger'

/**
 * Envía un correo por la API HTTP de Brevo (sin paquete npm). Devuelve false
 * si no hay BREVO_API_KEY o si Brevo responde error; nunca lanza.
 */
export async function enviarCorreo(destino: string, asunto: string, html: string): Promise<boolean> {
  const apiKey = env.get('BREVO_API_KEY')
  if (!apiKey) {
    logger.warn('Sin BREVO_API_KEY: correo no enviado')
    return false
  }
  try {
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': apiKey, 'content-type': 'application/json', 'accept': 'application/json' },
      body: JSON.stringify({
        sender: { name: env.get('MAIL_FROM_NAME', 'CargaExpress'), email: env.get('MAIL_FROM') },
        to: [{ email: destino }],
        subject: asunto,
        htmlContent: html,
      }),
    })
    if (!res.ok) {
      logger.error(`Brevo respondió ${res.status}: ${(await res.text()).slice(0, 300)}`)
      return false
    }
    return true
  } catch (err: any) {
    logger.error(`Brevo falló: ${err?.message}`)
    return false
  }
}
