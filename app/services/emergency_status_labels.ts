const ALERTA_STATUS_LABELS: Record<string, string> = {
  pendiente: 'Pendiente de atención',
  atendida: 'Emergencia en proceso',
  resuelta: 'Emergencia resuelta',
}

export function getAlertaEstadoLabel(estado: string | null | undefined): string {
  if (!estado) return 'Pendiente de atención'
  return ALERTA_STATUS_LABELS[estado] ?? 'Pendiente de atención'
}