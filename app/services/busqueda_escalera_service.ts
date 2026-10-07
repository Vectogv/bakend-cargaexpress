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
 *   • sugerencia (min `minSugerencia`): precio sugerido = km × tarifa por km del tipo de vehículo.
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
  /** Pesos por km según el tipo de vehículo (0 = sin sugerencia para ese tipo). */
  tarifaKm: { piaggio: number; furgon: number; camioneta: number }
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
  tarifaKm: { piaggio: 0, furgon: 0, camioneta: 0 },
  etapas: { ampliar: true, sugerencia: true, cierre: true },
}

const ESTADOS_BUSQUEDA = ['buscando_conductor', 'pendiente']
const ORDEN: EtapaBusqueda[] = ['publicado', 'ampliada', 'sugerencia', 'cierre']

/** Config guardada mezclada con los valores por defecto; el radio ampliado nunca pasa el tope antifraude. */
export function mezclarEscalera(guardada: unknown): EscaleraConfig {
  const g = (guardada && typeof guardada === 'object' ? guardada : {}) as Partial<EscaleraConfig>
  const cfg: EscaleraConfig = {
    ...ESCALERA_DEFAULT,
    ...g,
    etapas: { ...ESCALERA_DEFAULT.etapas, ...(g.etapas ?? {}) },
    tarifaKm: { ...ESCALERA_DEFAULT.tarifaKm, ...(g.tarifaKm ?? {}) },
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
  const cfg: EscaleraConfig = { ...actual, etapas: { ...actual.etapas }, tarifaKm: { ...actual.tarifaKm } }
  const rangos: Array<[keyof EscaleraConfig, number, number]> = [
    ['radioInicialKm', 1, antifraudeConfig.radioOfertaKm],
    ['radioAmpliadoKm', 1, antifraudeConfig.radioOfertaKm],
    ['minAmpliar', 1, 120],
    ['minSugerencia', 1, 120],
    ['minCierre', 1, 240],
    ['minRespuestaCierre', 1, 60],
    ['minSeguirEsperando', 1, 240],
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
  if (e.tarifaKm !== undefined) {
    if (!e.tarifaKm || typeof e.tarifaKm !== 'object' || Array.isArray(e.tarifaKm)) {
      return { error: 'tarifaKm debe ser un objeto' }
    }
    for (const k of ['piaggio', 'furgon', 'camioneta'] as const) {
      const v = (e.tarifaKm as Record<string, unknown>)[k]
      if (v === undefined) continue
      const n = Number(v)
      if (v === null || v === '' || !Number.isFinite(n) || n < 0 || n > 100000) {
        return { error: `tarifaKm.${k} debe estar entre 0 y 100000` }
      }
      cfg.tarifaKm[k] = Math.round(n)
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
  return { valor: cfg }
}

const pesos = (n: number) => `$${Math.round(n).toLocaleString('es-CO')}`

/** Distancia origen→destino en línea recta, 1 decimal (el modelo no guarda la distancia). */
const kmDe = (v: Viaje) =>
  Math.round(distanciaKm(Number(v.origenLat), Number(v.origenLng), Number(v.destinoLat), Number(v.destinoLng)) * 10) / 10

/** Objeto `busqueda` del payload del viaje (null si no está buscando o no entró a la escalera). */
export function busquedaDe(viaje: Viaje) {
  const etapa = viaje.busquedaEtapa as EtapaBusqueda | null
  if (!etapa || !ESTADOS_BUSQUEDA.includes(viaje.estado)) return null
  const precioSugerido =
    viaje.precioSugeridoMin != null && viaje.precioSugeridoMax != null
      ? { min: Number(viaje.precioSugeridoMin), max: Number(viaje.precioSugeridoMax), km: kmDe(viaje) }
      : null
  const mensajes: Record<EtapaBusqueda, string> = {
    publicado: 'Tu solicitud fue publicada. Estamos avisando a los conductores cercanos.',
    ampliada: 'Estamos ampliando la búsqueda para encontrarte conductor.',
    sugerencia: precioSugerido
      ? `Para ${precioSugerido.km.toLocaleString('es-CO')} km, el valor sugerido es ${pesos(precioSugerido.min)}`
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

// round(…,2) antes del ceil: 1.9 * 50000 da 95000.00000000001 en coma flotante.
const redondearArribaMil = (n: number) => Math.ceil(Math.round(n * 100) / 100 / 1000) * 1000

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
   * Precio sugerido = km (línea recta origen→destino, 1 decimal) × tarifa por km del tipo
   * de vehículo, redondeado hacia arriba a $1.000. Null si la tarifa es 0 o no supera el precio actual.
   */
  static async rangoSugerido(viaje: Viaje, cfg: EscaleraConfig): Promise<{ min: number; max: number } | null> {
    const precio = Number(viaje.precioCliente ?? viaje.precioEstimado ?? 0)
    const tarifa = this.tarifaDe(viaje.tipoVehiculoRequerido, cfg)
    if (precio <= 0 || tarifa <= 0) return null
    const sugerido = redondearArribaMil(kmDe(viaje) * tarifa)
    return sugerido > precio ? { min: sugerido, max: sugerido } : null
  }

  static tarifaDe(tipo: string | null | undefined, cfg: EscaleraConfig): number {
    const t = (tipo ?? '').toLowerCase()
    if (t.includes('furgon') || t.includes('furgón')) return cfg.tarifaKm.furgon
    if (t.includes('camioneta')) return cfg.tarifaKm.camioneta
    if (t.includes('piaggio') || t.includes('mini') || t.includes('estacas')) return cfg.tarifaKm.piaggio
    // ponytail: tipo desconocido o vacío → la tarifa más baja mayor que 0, para no inflar el precio a ciegas.
    const positivas = Object.values(cfg.tarifaKm).filter((n) => n > 0)
    return positivas.length ? Math.min(...positivas) : 0
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
