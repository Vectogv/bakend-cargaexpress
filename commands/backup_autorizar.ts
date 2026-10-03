import { createServer } from 'node:http'
import { BaseCommand, flags } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'
import { google } from 'googleapis'

const PUERTO = 53682

export default class BackupAutorizar extends BaseCommand {
  static commandName = 'backup:autorizar'
  static description = 'Obtiene (una sola vez, en tu PC) el permiso para subir respaldos a tu Google Drive'
  static options: CommandOptions = { startApp: false }

  @flags.string({ description: 'ID de cliente OAuth (o variable GOOGLE_OAUTH_CLIENT_ID)' })
  declare clientId?: string

  @flags.string({ description: 'Secreto de cliente OAuth (o variable GOOGLE_OAUTH_CLIENT_SECRET)' })
  declare clientSecret?: string

  async run() {
    const id = this.clientId || process.env.GOOGLE_OAUTH_CLIENT_ID
    const secret = this.clientSecret || process.env.GOOGLE_OAUTH_CLIENT_SECRET
    if (!id || !secret) {
      this.logger.error('Faltan el ID y el secreto del cliente OAuth de Google.')
      this.logger.info('Ejemplo: node ace backup:autorizar --client-id=XXXX --client-secret=YYYY')
      this.exitCode = 1
      return
    }

    const redirect = `http://127.0.0.1:${PUERTO}`
    const oauth = new google.auth.OAuth2(id, secret, redirect)
    const url = oauth.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: ['https://www.googleapis.com/auth/drive.file'],
    })

    this.logger.info('1. Abre este enlace en tu navegador e inicia sesión con cargaexpressgv@gmail.com:')
    console.log(`\n${url}\n`)
    this.logger.info('2. Acepta los permisos (si dice "app no verificada": Avanzado, luego Ir a la app).')
    this.logger.info(`Esperando la respuesta de Google en ${redirect} ...`)

    const codigo = await new Promise<string>((resolve, reject) => {
      const servidor = createServer((req, res) => {
        const params = new URL(req.url ?? '/', redirect).searchParams
        const code = params.get('code')
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(
          code
            ? '<h2>Listo. Ya puedes cerrar esta pestaña y volver a la terminal.</h2>'
            : '<h2>No se recibió el permiso.</h2>'
        )
        servidor.close()
        if (code) resolve(code)
        else reject(new Error(params.get('error') || 'Google no devolvió un código'))
      })
      servidor.on('error', reject)
      servidor.listen(PUERTO, '127.0.0.1')
    })

    const { tokens } = await oauth.getToken(codigo)
    if (!tokens.refresh_token) {
      this.logger.error(
        'Google no entregó refresh token. Quita el acceso de la app en https://myaccount.google.com/permissions y repite.'
      )
      this.exitCode = 1
      return
    }
    this.logger.success('Listo. Pon estas 3 variables en Railway:')
    console.log(
      `\nGOOGLE_OAUTH_CLIENT_ID=${id}\nGOOGLE_OAUTH_CLIENT_SECRET=${secret}\nGOOGLE_OAUTH_REFRESH_TOKEN=${tokens.refresh_token}\n`
    )
  }
}
