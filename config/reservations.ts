import env from '#start/env'

/**
 * Configuración centralizada de las reservas programadas.
 *
 * Todos los valores son configurables por variables de entorno para no dejar
 * "reglas de negocio" quemadas en múltiples archivos.
 */
const reservationConfig = {
  /**
   * Anticipación mínima exigida para crear una reserva (minutos).
   * Una reserva debe hacerse al menos N minutos antes de la hora programada.
   */
  minLeadMinutes: Number(env.get('RESERVATION_MIN_LEAD_TIME_MINUTES', 120)),

  /**
   * Anticipación con la que el scheduler inicia la búsqueda de conductor
   * antes de la hora programada (minutos).
   */
  dispatchLeadMinutes: Number(env.get('RESERVATION_DISPATCH_LEAD_MINUTES', 120)),

  /**
   * Ventana usada para detectar conflictos de horario entre viajes de un mismo
   * conductor (minutos alrededor de la hora programada).
   */
  scheduleConflictWindowMinutes: Number(env.get('RESERVATION_CONFLICT_WINDOW_MINUTES', 90)),

  /**
   * Anticipación con la que se envía el recordatorio al cliente antes de la
   * hora programada (minutos). Por defecto, 24 horas.
   */
  reminderLeadMinutes: Number(env.get('RESERVATION_REMINDER_LEAD_MINUTES', 1440)),

  /** Máximo de reservas a activar en una ejecución del scheduler. */
  activationBatchSize: Number(env.get('RESERVATION_ACTIVATION_BATCH_SIZE', 50)),

  /** Zona horaria de operación (Popayán/Cali/Pasto). */
  timezone: env.get('RESERVATION_TIMEZONE', 'America/Bogota'),
}

export default reservationConfig
