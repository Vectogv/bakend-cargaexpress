import { TIPOS_CIERRE_SOS } from '#models/alerta_emergencia'

/**
 * Valida los campos obligatorios para cerrar (resolver) un SOS: tipo de caso
 * y la gestión realizada (observación), exigidos para la auditoría (pedido
 * del usuario, 2026-10-09). Se usa en moderator_controller y admin_controller.
 */
export interface CierreSosValido {
  tipoCierre: string
  observacion: string
}

export function validarCierreSos(
  tipoCierreInput: unknown,
  observacionInput: unknown
): { ok: true; valor: CierreSosValido } | { ok: false; error: string } {
  const tipoCierre = String(tipoCierreInput ?? '').trim()
  if (!tipoCierre || !Object.hasOwn(TIPOS_CIERRE_SOS, tipoCierre)) {
    return { ok: false, error: 'Elige el tipo de caso' }
  }

  const observacion = String(observacionInput ?? '').trim()
  if (observacion.length < 20) {
    return { ok: false, error: 'Escribe la gestión realizada (mínimo 20 caracteres)' }
  }
  if (observacion.length > 1000) {
    return { ok: false, error: 'La gestión realizada no puede superar los 1000 caracteres' }
  }

  return { ok: true, valor: { tipoCierre, observacion } }
}
