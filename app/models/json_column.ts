/**
 * Opciones para columnas JSON. MySQL acepta objetos en el bind, pero SQLite
 * (tests y desarrollo) solo acepta texto: se serializa al guardar y se parsea al
 * leer, así el modelo se comporta igual en los dos motores.
 */
export const jsonColumn = {
  prepare: (value: unknown) =>
    value === null || value === undefined || typeof value === 'string' ? value : JSON.stringify(value),
  consume: (value: unknown) => {
    if (typeof value !== 'string') return value
    try {
      return JSON.parse(value)
    } catch {
      return null
    }
  },
}
