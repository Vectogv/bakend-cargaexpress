import env from '#start/env'

/**
 * Configuración centralizada de reglas antifraude.
 * Todos los valores son configurables por variables de entorno.
 */
const antifraudeConfig = {
  /**
   * Radio máximo en kilómetros para permitir cerrar un servicio (complete/finalize).
   * El conductor debe estar a menos de esta distancia del DESTINO.
   */
  radioCierreKm: Number(env.get('ANTIFRAUDE_RADIO_CIERRE_KM', 1)),

  /**
   * Radio máximo en kilómetros para permitir marcar la recogida (confirm-pickup/start-trip).
   * El conductor debe estar a menos de esta distancia del ORIGEN.
   */
  radioRecogidaKm: Number(env.get('ANTIFRAUDE_RADIO_RECOGIDA_KM', 1)),

  /**
   * Tiempo máximo en segundos desde la última actualización de ubicación
   * para considerarla "reciente". Si la ubicación es más vieja, se rechaza.
   */
  ubicacionMaxSeg: Number(env.get('ANTIFRAUDE_UBICACION_MAX_SEG', 180)),

  /**
   * H2: Radio máximo en kilómetros entre la ubicación guardada/reciente del
   * conductor y el ORIGEN del viaje para poder crear una oferta.
   */
  radioOfertaKm: Number(env.get('ANTIFRAUDE_RADIO_OFERTA_KM', 20)),

  /**
   * Radio (km) alrededor del ORIGEN en el que el cliente ve los vehículos
   * disponibles mientras busca conductor.
   */
  radioConductoresVisiblesKm: Number(env.get('CONDUCTORES_VISIBLES_RADIO_KM', 2)),

  /**
   * H1: Minutos que un viaje puede permanecer en 'pendiente_confirmacion'
   * sin respuesta del cliente antes de notificar al moderador de zona.
   */
  confirmacionTimeoutMin: Number(env.get('ANTIFRAUDE_CONFIRMACION_TIMEOUT_MIN', 10)),

  /**
   * H4: Puntos de reputación que se restan al conductor (o al cliente) cuando
   * cancela un viaje ya asignado (mínimo 1.0).
   */
  penalizacionCancelacion: Number(env.get('ANTIFRAUDE_PENALIZACION_CANCELACION', 0.5)),
}

export default antifraudeConfig