import { DateTime } from 'luxon'
import logger from '@adonisjs/core/services/logger'
import Viaje from '#models/viaje'
import User from '#models/user'
import Oferta from '#models/oferta'
import ConfiguracionPlataforma from '#models/configuracion_plataforma'
import antifraudeConfig from '#config/antifraude'
import TripDispatchService from '#services/trip_dispatch_service'
import { distanciaKm } from '#services/geo_service'
import { emitToClient } from '#start/socket'
import { sendToToken } from '#services/push_notification_service'
import { emitTripUpdateToModerators } from '#services/moderator_trip_events'

/**
 * Escalera de acompañamiento para viajes sin ofertas (etapas 1, 2, 3 y 6).
 *
 * El viaje no cambia de estado: sigue en `buscando_conductor`/`pendiente` y
 * lleva `busqueda_etapa` ('publicado' → 'ampliada' → 'sugerencia' → 'cierre').
 * `busqueda_hasta` es el corte de la cancelación automática (BusquedaTimeoutService).
 *
 *   • publicado  (al pedir):      aviso a los conductores dentro de `radioInicialKm`.
 *   • ampliada   (min `minAmpliar`):   reenvío entre `radioInicialKm` y `radioAmpliadoKm`,
 *                                      incluyendo a los que están terminando un viaje.
 *   • sugerencia (min `minSugerencia`): rango de precio de viajes parecidos (o +pct% de respaldo).
 *   • cierre     (`minRespuestaCierre` min antes de `busqueda_hasta`): se le pregunta al cliente;
 *                "seguir esperando" reinicia el ciclo en 'ampliada' con `minSeguirEsperando` más.
 *
 * Cada etapa se aplica una sola vez por ciclo gracias a un UPDATE condicionado
 * por la etapa actual (mismo patrón que ConfirmacionTimeoutService). Un viaje
 * con una oferta viva (pendiente sin vencer o aceptada) no sube de etapa.
 * Los viajes sin `busqueda_etapa` (viejos, reservas activadas) no entran.
 */

export type EtapaBusqueda = 'publicado' | 'ampliada' | 'sugerencia' | 'cierre'

export interface EscaleraConfig {
  radioInicialKm: number
  minAmpliar: number
  radioAmpliadoKm: number
  minSugerencia: number
  minCierre: number
  minRespuestaCierre: number
  minSeguirEsperando: number
  pctSugerenciaMin: number
  pctSugerenciaMax: number
  etapas: { ampliar: boolean; sugerencia: boolean; cierre: boolean }
}

export const ESCALERA_DEFAULT: EscaleraConfig = {
  radioInicialKm: 3,
  minAmpliar: 3,
  radioAmpliadoKm: 8,
  minSugerencia: 5,
  minCierre: 20,
  minRespuestaCierre: 10,
  minSeguirEsperando: 20,
  pctSugerenciaMin: 15,
  pctSugerenciaMax: 30,
  etapas: { ampliar: true, sugerencia: true, cierre: true },
}

const ESTADOS_BUSQUEDA = ['buscando_conductor', 'pendiente']
const ORDEN: EtapaBusqueda[] = ['publicado', 'ampliada', 'sugerencia', 'cierre']
/** Viajes finalizados que se miran para el rango de precio (los más recientes). */
const MUESTRA_HISTORIAL = 500
const MINIMO_PARECIDOS = 5

/** Config guardada mezclada con los valores por defecto; el radio ampliado nunca pasa el tope antifraude. */
export function mezclarEscalera(guardada: unknown): EscaleraConfig {
  const g = (guardada && typeof guardada === 'object' ? guardada : {}) as Partial<EscaleraConfig>
  const cfg: EscaleraConfig = {
    ...ESCALERA_DEFAULT,
    ...g,
    etapas: { ...ESCALERA_DEFAULT.etapas, ...(g.etapas ?? {}) },
  }
  cfg.radioAmpliadoKm = Math.min(cfg.radioAmpliadoKm, antifraudeConfig.radioOfertaKm)
  cfg.radioInicialKm = Math.min(cfg.radioInicialKm, cfg.radioAmpliadoKm)
  return cfg
}

export async function escaleraConfig(): Promise<EscaleraConfig> {
  const config = await ConfiguracionPlataforma.unica()
  return mezclarEscalera(config?.escalera)
}

/**
 * Valida lo que manda el admin (PUT /api/admin/config). Acepta parciales:
 * se mezcla sobre `actual` y se revisa el resultado completo.
 */
export function validarEscalera(
  entrada: unknown,
  actual: EscaleraConfig
): { valor: EscaleraConfig } | { error: string } {
  if (!entrada || typeof entrada !== 'object' || Array.isArray(entrada)) {
    return { error: 'escalera debe ser un objeto' }
  }
  const e = entrada as Record<string, unknown>
  const cfg: EscaleraConfig = { ...actual, etapas: { ...actual.etapas } }
  const rangos: Array<[keyof EscaleraConfig, number, number]> = [
    ['radioInicialKm', 1, antifraudeConfig.radioOfertaKm],
    ['radioAmpliadoKm', 1, antifraudeConfig.radioOfertaKm],
    ['minAmpliar', 1, 120],
    ['minSugerencia', 1, 120],
    ['minCierre', 1, 240],
    ['minRespuestaCierre', 1, 60],
    ['minSeguirEsperando', 1, 240],
    ['pctSugerenciaMin', 1, 200],
    ['pctSugerenciaMax', 1, 300],
  ]
  for (const [campo, min, max] of rangos) {
    if (e[campo] === undefined) continue
    const n = Number(e[campo])
    if (!Number.isFinite(n) || n < min || n > max) {
      return { error: `${campo} debe estar entre ${min} y ${max}` }
    }
    ;(cfg as any)[campo] = Math.round(n)
  }
  if (e.etapas !== undefined) {
    if (!e.etapas || typeof e.etapas !== 'object') return { error: 'etapas debe ser un objeto' }
    for (const k of ['ampliar', 'sugerencia', 'cierre'] as const) {
      const v = (e.etapas as Record<string, unknown>)[k]
      if (v === undefined) continue
      if (typeof v !== 'boolean') return { error: `etapas.${k} debe ser true o false` }
      cfg.etapas[k] = v
    }
  }
  if (cfg.radioAmpliadoKm < cfg.radioInicialKm) {
    return { error: 'radioAmpliadoKm debe ser mayor o igual que radioInicialKm' }
  }
  if (!(cfg.minAmpliar < cfg.minSugerencia && cfg.minSugerencia < cfg.minCierre)) {
    return { error: 'Los minutos deben ir en orden: minAmpliar < minSugerencia < minCierre' }
  }
  if (cfg.minSeguirEsperando <= cfg.minRespuestaCierre) {
    return { error: 'minSeguirEsperando debe ser mayor que minRespuestaCierre' }
  }
  if (cfg.pctSugerenciaMax <= cfg.pctSugerenciaMin) {
    return { error: 'pctSugerenciaMax debe ser mayor que pctSugerenciaMin' }
  }
  return { valor: cfg }
}

const pesos = (n: number) => `$${Math.round(n).toLocaleString('es-CO')}`

/** Objeto `busqueda` del payload del viaje (null si no está buscando o no entró a la escalera). */
export function busquedaDe(viaje: Viaje) {
  const etapa = viaje.busquedaEtapa as EtapaBusqueda | null
  if (!etapa || !ESTADOS_BUSQUEDA.includes(viaje.estado)) return null
  const precioSugerido =
    viaje.precioSugeridoMin != null && viaje.precioSugeridoMax != null
      ? { min: Number(viaje.precioSugeridoMin), max: Number(viaje.precioSugeridoMax) }
      : null
  const mensajes: Record<EtapaBusqueda, string> = {
    publicado: 'Tu solicitud fue publicada. Estamos avisando a los conductores cercanos.',
    ampliada: 'Estamos ampliando la búsqueda para encontrarte conductor.',
    sugerencia: precioSugerido
      ? `Los viajes parecidos se están pagando entre ${pesos(precioSugerido.min)} y ${pesos(precioSugerido.max)}. Subir tu oferta puede ayudarte a conseguir conductor más rápido.`
      : 'Estamos ampliando la búsqueda para encontrarte conductor.',
    cierre: 'No logramos conseguir conductor por ahora. ¿Qué prefieres?',
  }
  return {
    etapa,
    mensaje: mensajes[etapa],
    precioSugerido: etapa === 'sugerencia' ? precioSugerido : null,
    cierreHasta: etapa === 'cierre' ? (viaje.busquedaHasta?.toISO() ?? null) : null,
  }
}

const redondearMil = (n: number) => Math.round(n / 1000) * 1000

export default class BusquedaEscaleraService {
  /** Barrido del scheduler: sube de etapa los viajes que toque. Devuelve {id, etapa} de los que cambió. */
  static async avanzar(now: DateTime = DateTime.now()): Promise<Array<{ id: number; etapa: EtapaBusqueda }>> {
    const cfg = await escaleraConfig()
    const candidatos = await Viaje.query()
      .whereIn('estado', ESTADOS_BUSQUEDA)
      .whereIn('busqueda_etapa', ['publicado', 'ampliada', 'sugerencia'])
    const cambios: Array<{ id: number; etapa: EtapaBusqueda }> = []
    for (const viaje of candidatos) {
      try {
        const etapa = await this.avanzarViaje(viaje, cfg, now)
        if (etapa) cambios.push({ id: viaje.id, etapa })
      } catch (err) {
        logger.error({ err, viajeId: viaje.id }, 'BusquedaEscaleraService: fallo avanzando viaje')
      }
    }
    return cambios
  }

  /** Una etapa por barrido, en orden; nada si hay una oferta viva. */
  private static async avanzarViaje(
    viaje: Viaje,
    cfg: EscaleraConfig,
    now: DateTime
  ): Promise<EtapaBusqueda | null> {
    if (await this.tieneOfertaViva(viaje.id, now)) return null

    const actual = viaje.busquedaEtapa as EtapaBusqueda
    const inicio = this.inicioBusqueda(viaje)
    const minutos = inicio ? now.diff(inicio, 'minutes').minutes : 0
    const hasta = viaje.busquedaHasta ?? inicio?.plus({ minutes: cfg.minCierre + cfg.minRespuestaCierre }) ?? null
    const rango = ORDEN.indexOf(actual)

    if (cfg.etapas.ampliar && rango < ORDEN.indexOf('ampliada') && minutos >= cfg.minAmpliar) {
      if (!(await this.marcar(viaje, actual, { busqueda_etapa: 'ampliada', busqueda_etapa_en: now }))) return null
      await this.reenviar(viaje, cfg)
      await this.avisarCliente(viaje, 'Ampliamos la búsqueda')
      return 'ampliada'
    }
    if (cfg.etapas.sugerencia && rango < ORDEN.indexOf('sugerencia') && minutos >= cfg.minSugerencia) {
      const sugerido = await this.rangoSugerido(viaje, cfg)
      if (sugerido) {
        const ok = await this.marcar(viaje, actual, {
          busqueda_etapa: 'sugerencia',
          busqueda_etapa_en: now,
          precio_sugerido_min: sugerido.min,
          precio_sugerido_max: sugerido.max,
        })
        if (!ok) return null
        await this.avisarCliente(viaje, 'Sube tu oferta y consigue conductor más rápido')
        return 'sugerencia'
      }
    }
    if (cfg.etapas.cierre && hasta && now >= hasta.minus({ minutes: cfg.minRespuestaCierre })) {
      const nuevoHasta = now.plus({ minutes: cfg.minRespuestaCierre })
      const ok = await this.marcar(viaje, actual, {
        busqueda_etapa: 'cierre',
        busqueda_etapa_en: now,
        busqueda_hasta: nuevoHasta,
      })
      if (!ok) return null
      await this.avisarCliente(viaje, 'No encontramos conductor aún')
      return 'cierre'
    }
    return null
  }

  /** "Seguir esperando" (etapa cierre): otro ciclo en 'ampliada' con `minSeguirEsperando` más. */
  static async seguirEsperando(viaje: Viaje, cfg: EscaleraConfig, now: DateTime = DateTime.now()): Promise<boolean> {
    const ok = await this.marcar(viaje, 'cierre', {
      busqueda_etapa: 'ampliada',
      busqueda_etapa_en: now,
      busqueda_hasta: now.plus({ minutes: cfg.minSeguirEsperando }),
    })
    if (!ok) return false
    await this.reenviar(viaje, cfg)
    this.emitirAlCliente(viaje)
    return true
  }

  /** Reenvía el viaje a los conductores del radio de la etapa actual (precio nuevo o ciclo nuevo). */
  static async reenviar(viaje: Viaje, cfg: EscaleraConfig): Promise<number> {
    if (viaje.busquedaEtapa === 'publicado' || !viaje.busquedaEtapa) {
      return TripDispatchService.buscarConductores(viaje, cfg.radioInicialKm)
    }
    return TripDispatchService.buscarConductores(viaje, cfg.radioAmpliadoKm, { incluirTerminando: true })
  }

  /** Solo quien de verdad cambia la fila (etapa actual intacta) sigue con avisos. */
  private static async marcar(viaje: Viaje, etapaActual: EtapaBusqueda, cambios: Record<string, unknown>): Promise<boolean> {
    const fila: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(cambios)) fila[k] = DateTime.isDateTime(v) ? v.toSQL() : v
    const resultado = await Viaje.query()
      .where('id', viaje.id)
      .where('busqueda_etapa', etapaActual)
      .whereIn('estado', ESTADOS_BUSQUEDA)
      .update(fila)
    const filas = Array.isArray(resultado) ? Number(resultado[0]) : Number(resultado)
    if (filas !== 1) return false
    await viaje.refresh()
    return true
  }

  private static async tieneOfertaViva(viajeId: number, now: DateTime): Promise<boolean> {
    const ofertas = await Oferta.query().where('viaje_id', viajeId).whereIn('estado', ['pendiente', 'aceptada'])
    return ofertas.some((o) => o.estado === 'aceptada' || (o.expiraAt != null && o.expiraAt > now))
  }

  private static inicioBusqueda(viaje: Viaje): DateTime | null {
    if (viaje.tipoProgramacion === 'programada' && viaje.activacionAt) return viaje.activacionAt
    return viaje.createdAt ?? null
  }

  /**
   * Rango de precio de viajes finalizados parecidos (mismo tipo de vehículo requerido,
   * distancia ±30 %): percentiles 25-75 de `precio_final`. Con menos de 5, respaldo de
   * +pct% sobre el precio del cliente. Redondeado a $1.000. Null si no supera el precio actual.
   */
  static async rangoSugerido(viaje: Viaje, cfg: EscaleraConfig): Promise<{ min: number; max: number } | null> {
    const precio = Number(viaje.precioCliente ?? viaje.precioEstimado ?? 0)
    if (precio <= 0) return null

    const dist = distanciaKm(Number(viaje.origenLat), Number(viaje.origenLng), Number(viaje.destinoLat), Number(viaje.destinoLng))
    const query = Viaje.query()
      .where('estado', 'finalizado')
      .whereNotNull('precio_final')
      .whereNot('id', viaje.id)
      .orderBy('id', 'desc')
      .limit(MUESTRA_HISTORIAL)
    if (viaje.tipoVehiculoRequerido) query.where('tipo_vehiculo_requerido', viaje.tipoVehiculoRequerido)
    const historial = await query
    const precios = historial
      .filter((v) => {
        const d = distanciaKm(Number(v.origenLat), Number(v.origenLng), Number(v.destinoLat), Number(v.destinoLng))
        return Math.abs(d - dist) <= dist * 0.3
      })
      .map((v) => Number(v.precioFinal))
      .filter((p) => p > 0)
      .sort((a, b) => a - b)

    let min: number
    let max: number
    if (precios.length >= MINIMO_PARECIDOS) {
      const p = (q: number) => precios[Math.min(precios.length - 1, Math.floor(q * precios.length))]
      min = redondearMil(p(0.25))
      max = redondearMil(p(0.75))
    } else {
      // Entero antes de dividir: 50000 * 1.15 da 57499.99… en coma flotante.
      min = redondearMil((precio * (100 + cfg.pctSugerenciaMin)) / 100)
      max = redondearMil((precio * (100 + cfg.pctSugerenciaMax)) / 100)
    }
    // "Subir a $min" solo tiene sentido si el rango queda por encima del precio actual.
    if (min <= precio) return null
    return { min, max: Math.max(max, min) }
  }

  /** Socket al cliente + moderadores con el objeto `busqueda` (misma forma que /trips/active). */
  static emitirAlCliente(viaje: Viaje) {
    const busqueda = busquedaDe(viaje)
    emitToClient(viaje.clienteId, 'trip:status_changed', {
      id: String(viaje.id),
      estado: viaje.estado,
      precioEstimado: viaje.precioEstimado ?? null,
      busqueda,
    })
    emitTripUpdateToModerators(viaje, { busqueda })
  }

  private static async avisarCliente(viaje: Viaje, titulo: string) {
    this.emitirAlCliente(viaje)
    const mensaje = busquedaDe(viaje)?.mensaje ?? titulo
    const cliente = await User.find(viaje.clienteId)
    if (cliente?.fcmToken) {
      await sendToToken(cliente.fcmToken, titulo, mensaje, { tipo: 'viaje_estado', viajeId: String(viaje.id) }).catch(
        (err: unknown) => logger.warn({ err, viajeId: viaje.id }, 'BusquedaEscaleraService: push falló')
      )
    }
  }
}
