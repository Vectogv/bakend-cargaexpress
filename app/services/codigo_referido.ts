/**
 * Formato del código de referido de un conductor. Sin dependencias: lo usan la
 * migración (relleno de los conductores que ya existen) y ReferidosService.
 */

const LETRAS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

/** Hasta 6 letras del nombre (mayúsculas, sin tildes) + 3 dígitos de la placa (o 3 al azar). */
export function baseCodigo(nombre: string | null | undefined, placa: string | null | undefined): string {
  const letras =
    (nombre || '')
      .normalize('NFD')
      .replace(/[^A-Za-z]/g, '')
      .toUpperCase()
      .slice(0, 6) || 'CARGA'
  const digitos = (placa || '').replace(/\D/g, '')
  const numero =
    digitos.length >= 3 ? digitos.slice(0, 3) : String(Math.floor(Math.random() * 1000)).padStart(3, '0')
  return letras + numero
}

/** `base`, y si choca `base`+A…Z, luego +AA…ZZ (máx. 12 caracteres). */
export function codigoLibre(base: string, usados: Set<string>): string {
  if (!usados.has(base)) return base
  for (const a of LETRAS) if (!usados.has(base + a)) return base + a
  for (const a of LETRAS) for (const b of LETRAS) if (!usados.has(base + a + b)) return base + a + b
  throw new Error(`Sin códigos de referido libres para ${base}`)
}
