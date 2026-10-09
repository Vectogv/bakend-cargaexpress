import { TIPOS_CIERRE_SOS } from '#models/alerta_emergencia'

const ALERTA_STATUS_LABELS: Record<string, string> = {
  pendiente: 'Pendiente de atención',
  atendida: 'Emergencia en proceso',
  resuelta: 'Emergencia resuelta',
}

export function getAlertaEstadoLabel(estado: string | null | undefined): string {
  if (!estado) return 'Pendiente de atención'
  return ALERTA_STATUS_LABELS[estado] ?? 'Pendiente de atención'
}

export function getTipoCierreLabel(tipoCierre: string | null | undefined): string | null {
  if (!tipoCierre) return null
  return TIPOS_CIERRE_SOS[tipoCierre] ?? null
}