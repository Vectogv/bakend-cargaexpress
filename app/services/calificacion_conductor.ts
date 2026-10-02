import Calificacion from '#models/calificacion'
import type Conductor from '#models/conductor'

/**
 * Calificacion que ve todo el mundo: promedio de los clientes menos la
 * penalizacion por cancelaciones, con piso 1,0. Sin calificaciones ni
 * penalizacion queda en 0 (la app muestra "--"); con penalizacion parte de 5,0.
 */
export function calificacionVisible(promedio: number, penalizacion: number): number {
  if (promedio <= 0 && penalizacion <= 0) return 0
  const base = promedio > 0 ? promedio : 5
  return Math.round(Math.max(1, base - penalizacion) * 10) / 10
}

/** Recalcula y guarda `conductor.calificacion` con el promedio actual de sus calificaciones. */
export async function recalcularCalificacionConductor(conductor: Conductor): Promise<number> {
  const avg = await Calificacion.query()
    .where('calificado_id', conductor.usuarioId)
    .where('tipo', 'cliente_a_conductor')
    .avg('puntaje as promedio')
    .first()
  const promedio = Number(avg?.$extras?.promedio || 0)
  conductor.calificacion = calificacionVisible(promedio, Number(conductor.penalizacionCancelacion || 0))
  await conductor.save()
  return promedio
}