import type { HttpContext } from '@adonisjs/core/http'
import EmpresaService, { EmpresaError } from '#services/empresa_service'
import { TELEFONO_REGEX } from '#validators/profile'

const EXTENSIONES = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'pdf']

/** Mismo cuerpo de error que los demás endpoints con `code` (p. ej. el registro con referido). */
function fallo(response: HttpContext['response'], err: unknown) {
  if (err instanceof EmpresaError) {
    return response.status(err.status).send({ error: err.message, message: err.message, code: err.code })
  }
  throw err
}

/** Cuentas de empresa del cliente. Las reglas viven en EmpresaService. */
export default class EmpresaController {
  /** POST /api/empresas (multipart: nombre, nit, direccion, telefono, rut, camara). */
  async store({ auth, request, response, serialize }: HttpContext) {
    const user = auth.getUserOrFail()
    const nombre = String(request.input('nombre', '') ?? '').trim().slice(0, 150)
    const nit = EmpresaService.normalizarNit(request.input('nit', ''))
    const direccion = String(request.input('direccion', '') ?? '').trim().slice(0, 200) || null
    const telefono = String(request.input('telefono', '') ?? '').trim().slice(0, 20) || null
    if (!nombre) return response.status(422).send({ error: 'El nombre de la empresa es obligatorio' })
    if (nit.length < 5 || nit.length > 20) return response.status(422).send({ error: 'NIT inválido' })
    if (telefono && !TELEFONO_REGEX.test(telefono)) {
      return response.status(422).send({ error: 'Teléfono inválido' })
    }

    const archivos: Parameters<typeof EmpresaService.registrar>[2] = {}
    for (const campo of ['rut', 'camara'] as const) {
      const file = request.file(campo, { size: '5mb', extnames: EXTENSIONES })
      if (file && !file.isValid) {
        return response.status(422).send({ error: file.errors[0]?.message || 'Archivo inválido' })
      }
      archivos[campo] = file
    }

    try {
      const empresa = await EmpresaService.registrar(user, { nombre, nit, direccion, telefono }, archivos)
      return response.status(201).send(await serialize.withoutWrapping(EmpresaService.empresaJson(empresa, true)))
    } catch (err) {
      return fallo(response, err)
    }
  }

  async mia({ auth, serialize }: HttpContext) {
    return serialize.withoutWrapping(await EmpresaService.mia(auth.getUserOrFail()))
  }

  /** GET /api/empresas/resumen?mes=YYYY-MM (solo el dueño). */
  async resumen({ auth, request, response, serialize }: HttpContext) {
    try {
      const empresa = await EmpresaService.comoDueno(auth.getUserOrFail())
      const mes = String(request.input('mes', '') || '').slice(0, 7)
      return serialize.withoutWrapping(await EmpresaService.resumenMes(empresa.id, mes))
    } catch (err) {
      return fallo(response, err)
    }
  }

  /** GET /api/empresas/reporte?mes=YYYY-MM → PDF (solo el dueño). */
  async reporte({ auth, request, response }: HttpContext) {
    try {
      const empresa = await EmpresaService.comoDueno(auth.getUserOrFail())
      const mes = String(request.input('mes', '') || '').slice(0, 7)
      const doc = EmpresaService.reportePdf(empresa, await EmpresaService.resumenMes(empresa.id, mes))
      response.type('application/pdf')
      response.header('Content-Disposition', `attachment; filename=empresa-${mes}.pdf`)
      return response.stream(doc)
    } catch (err) {
      return fallo(response, err)
    }
  }

  async unirse({ auth, request, response, serialize }: HttpContext) {
    try {
      return serialize.withoutWrapping(await EmpresaService.unirse(auth.getUserOrFail(), request.input('codigo')))
    } catch (err) {
      return fallo(response, err)
    }
  }

  async salir({ auth, response, serialize }: HttpContext) {
    try {
      await EmpresaService.salir(auth.getUserOrFail())
      return serialize.withoutWrapping({ ok: true })
    } catch (err) {
      return fallo(response, err)
    }
  }

  async quitarMiembro({ auth, params, response, serialize }: HttpContext) {
    try {
      await EmpresaService.quitarMiembro(auth.getUserOrFail(), Number(params.userId))
      return serialize.withoutWrapping({ ok: true })
    } catch (err) {
      return fallo(response, err)
    }
  }
}
