import AlertaEmergencia from '#models/alerta_emergencia'
import Conductor from '#models/conductor'
import Disputa from '#models/disputa'
import TicketSoporte from '#models/ticket_soporte'
import db from '@adonisjs/lucid/services/db'
import { claveDe } from '#services/coverage_service'

/**
 * El moderador solo trata con conductores. A un cliente lo ve y lo contacta
 * únicamente cuando un caso los relaciona: un ticket de soporte de su zona, o
 * un SOS / una disputa en un viaje atendido por un conductor de su zona.
 */

export type CasosViaje = {
  tieneSos: boolean
  disputa: { id: number; estado: string } | null
  tickets: { id: number; asunto: string; estado: string }[]
}

/**
 * Conductores cuya ciudad (texto libre: 'Popayán', 'POPAYAN ') corresponde a la
 * zona dada. Se normaliza con claveDe en memoria porque SQLite (tests) y
 * Postgres (prod) no comparten una forma portable de quitar tildes en SQL.
 */
export async function conductoresDeZona(zona: string) {
  const filas = await Conductor.query().select('id', 'usuario_id', 'ciudad').whereNotNull('ciudad')
  const enZona = filas.filter((c) => claveDe(c.ciudad || '') === zona)
  return {
    conductorIds: enZona.map((c) => c.id),
    usuarioIds: enZona.map((c) => c.usuarioId),
  }
}

/** SOS, disputa y tickets de cada viaje, en tres consultas por lote. */
export async function casosPorViaje(viajeIds: number[]): Promise<Map<number, CasosViaje>> {
  const mapa = new Map<number, CasosViaje>()
  if (viajeIds.length === 0) return mapa
  const vacio = (): CasosViaje => ({ tieneSos: false, disputa: null, tickets: [] })
  const de = (id: number) => {
    const n = Number(id)
    if (!mapa.has(n)) mapa.set(n, vacio())
    return mapa.get(n)!
  }
  const [alertas, disputas, tickets] = await Promise.all([
    AlertaEmergencia.query().whereIn('viaje_id', viajeIds).select('id', 'viaje_id'),
    Disputa.query().whereIn('viaje_id', viajeIds).select('id', 'viaje_id', 'estado'),
    TicketSoporte.query().whereIn('viaje_id', viajeIds).select('id', 'viaje_id', 'asunto', 'estado'),
  ])
  for (const a of alertas) de(a.viajeId!).tieneSos = true
  for (const d of disputas) de(d.viajeId).disputa = { id: d.id, estado: d.estado }
  for (const t of tickets) de(t.viajeId!).tickets.push({ id: t.id, asunto: t.asunto, estado: t.estado })
  return mapa
}

export const casoVacio: CasosViaje = { tieneSos: false, disputa: null, tickets: [] }

export const hayCaso = (c: CasosViaje) => c.tieneSos || Boolean(c.disputa) || c.tickets.length > 0

/** Nombre de pila + inicial del apellido: lo único del cliente que ve el moderador sin un caso. */
export function nombreCorto(u: { nombre?: string | null; apellido?: string | null } | null | undefined) {
  if (!u) return ''
  const apellido = (u.apellido || '').trim()
  return `${(u.nombre || '').trim()} ${apellido ? `${apellido[0]}.` : ''}`.trim()
}

/** ¿Puede el moderador de `zona` contactar a este cliente? */
export async function clienteContactablePorModerador(clienteId: number, zona: string): Promise<boolean> {
  const ticket = await TicketSoporte.query().where('usuario_id', clienteId).where('zona', zona).select('id').first()
  if (ticket) return true
  const { conductorIds } = await conductoresDeZona(zona)
  if (conductorIds.length === 0) return false
  const sos = await AlertaEmergencia.query()
    .whereIn('viaje_id', db.from('viajes').select('id').where('cliente_id', clienteId).whereIn('conductor_id', conductorIds))
    .select('id')
    .first()
  if (sos) return true
  const disputa = await Disputa.query()
    .where('cliente_id', clienteId)
    .whereIn('conductor_id', conductorIds)
    .select('id')
    .first()
  return Boolean(disputa)
}
