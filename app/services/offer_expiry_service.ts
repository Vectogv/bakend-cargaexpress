import { DateTime } from 'luxon'
import logger from '@adonisjs/core/services/logger'
import Oferta from '#models/oferta'
import { emitToClient, emitToDriver } from '#start/socket'

/**
 * Ofertas vencidas: una oferta `pendiente` cuyo `expira_at` ya pasó se marca
 * `expirada`. Lo usan el scheduler interno (cada 30 s) y `node ace offers:expire`.
 *
 * Seguro con varias instancias o barridos solapados: cada oferta se actualiza con
 * `WHERE id = ? AND estado = 'pendiente'`, así solo quien la cambia de verdad
 * notifica; si otra instancia ya la expiró (o se aceptó entre medio), se omite.
 *
 * Avisos:
 * - Cliente: `offer:cancelled {viajeId, ofertaId}` (la app ya lo escucha y quita
 *   la oferta de la lista de ofertas recibidas).
 * - Conductor: `offer:expired {viajeId, ofertaId}`.
 */
export default class OfferExpiryService {
  /** Expira las ofertas vencidas y devuelve los ids que esta llamada expiró. */
  static async expirarVencidas(): Promise<number[]> {
    const ahora = DateTime.now().toSQL()!
    const candidatas = await Oferta.query()
      .where('estado', 'pendiente')
      .whereNotNull('expira_at')
      .where('expira_at', '<', ahora)
      .preload('conductor')
      .preload('viaje')

    return this.expirar(candidatas)
  }

  /**
   * Expira todas las ofertas pendientes de un viaje (p. ej. cuando la búsqueda
   * de conductor venció y el sistema cancela el viaje), con los mismos avisos.
   */
  static async expirarDelViaje(viajeId: number): Promise<number[]> {
    const candidatas = await Oferta.query()
      .where('viaje_id', viajeId)
      .where('estado', 'pendiente')
      .preload('conductor')
      .preload('viaje')
    return this.expirar(candidatas)
  }

  private static async expirar(candidatas: Oferta[]): Promise<number[]> {
    const expiradas: number[] = []
    for (const oferta of candidatas) {
      try {
        const resultado = await Oferta.query()
          .where('id', oferta.id)
          .where('estado', 'pendiente')
          .update({ estado: 'expirada' })
        const filas = Array.isArray(resultado) ? Number(resultado[0]) : Number(resultado)
        if (filas !== 1) continue

        expiradas.push(oferta.id)
        const payload = { viajeId: String(oferta.viajeId), ofertaId: String(oferta.id) }
        if (oferta.viaje) emitToClient(oferta.viaje.clienteId, 'offer:cancelled', payload)
        if (oferta.conductor) emitToDriver(oferta.conductor.usuarioId, 'offer:expired', payload)
      } catch (err) {
        logger.error({ err, ofertaId: oferta.id }, 'OfferExpiryService: fallo expirando oferta')
      }
    }
    return expiradas
  }
}
