import Viaje from '#models/viaje'
import Conductor from '#models/conductor'
import AlertaEmergencia from '#models/alerta_emergencia'
import { emitTripStatusChanged } from '#start/socket'
import TripStateMachine from '#services/trip_state_machine'
import type { EstadoViaje } from '#services/trip_state_machine'

/**
 * Al resolver una alerta SOS el viaje sale del estado 'sos'. Antes quedaba
 * atascado: desde 'sos' no se puede completar (sos → pendiente_confirmacion
 * no existe) y nada lo devolvía a su estado.
 *
 * El viaje no guarda el estado anterior al SOS: si ya había iniciado
 * (enCursoAt) vuelve a 'en_curso'; si no, a 'conductor_en_camino' (el
 * conductor confirma otra vez la llegada al origen). Ambas transiciones están
 * en trip_state_machine. Si el viaje tiene otra alerta sin atender, sigue en
 * 'sos'. Devuelve el estado nuevo, o null si no cambió.
 */
export async function restaurarViajeTrasSos(alerta: AlertaEmergencia): Promise<EstadoViaje | null> {
  if (!alerta.viajeId) return null
  const viaje = await Viaje.find(alerta.viajeId)
  if (!viaje || viaje.estado !== 'sos') return null

  const otraAbierta = await AlertaEmergencia.query()
    .where('viaje_id', viaje.id)
    .whereNot('id', alerta.id)
    .where('atendida', false)
    .first()
  if (otraAbierta) return null

  const destino: EstadoViaje = viaje.enCursoAt ? 'en_curso' : 'conductor_en_camino'
  if (!TripStateMachine.validarTransicion('sos', destino)) return null

  viaje.estado = destino
  await viaje.save()

  let conductorUsuarioId: number | null = null
  if (viaje.conductorId) {
    const conductor = await Conductor.find(viaje.conductorId)
    conductorUsuarioId = conductor?.usuarioId ?? null
  }
  emitTripStatusChanged(viaje.clienteId, conductorUsuarioId, {
    id: String(viaje.id),
    estado: destino,
  })
  return destino
}
