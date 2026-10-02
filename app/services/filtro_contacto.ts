// Antifraude del chat del viaje: no se comparten teléfonos, WhatsApp, Telegram
// ni correos, para que el cliente y el conductor no arreglen el viaje por fuera.
// ponytail: no detecta números escritos en letras ("tres cero cero..."); agregarlo si aparece en los reportes.
const PALABRAS = /wa\.me|whats\s*app|wh?atsap|wasap|guasap|telegram|t\.me\//i
const CORREO = /[\w.+-]+@[\w-]+\.[a-z]{2,}/i
const SECUENCIA_NUMERICA = /\+?\d[\d\s.\-()]*\d/g

export function contieneContacto(texto: string): boolean {
  if (PALABRAS.test(texto) || CORREO.test(texto)) return true
  // 7 o más dígitos seguidos (con espacios, puntos o guiones) = teléfono.
  // Los precios ("$90.000") y direcciones ("Calle 5 # 10-20") quedan por debajo.
  for (const m of texto.match(SECUENCIA_NUMERICA) ?? []) {
    if (m.replace(/\D/g, '').length >= 7) return true
  }
  return false
}

export const MENSAJE_CONTACTO_BLOQUEADO =
  'Por seguridad no se pueden compartir teléfonos, WhatsApp ni correos en el chat.'
