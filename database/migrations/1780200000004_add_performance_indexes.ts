import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    // ── users ─────────────────────────────────────────────────────
    // Filtrar por rol (cliente, conductor, admin) en auth/login admin
    this.schema.raw('CREATE INDEX idx_users_rol ON users (rol)')
    // Filtrar cuentas suspendidas en auth
    this.schema.raw('CREATE INDEX idx_users_suspendido ON users (suspendido)')
    // Filtrar por estado_cuenta (activa, suspension_por_pago, esperando_confirmacion)
    this.schema.raw('CREATE INDEX idx_users_estado_cuenta ON users (estado_cuenta)')
    // Ordenar por created_at en listados admin
    this.schema.raw('CREATE INDEX idx_users_created_at ON users (created_at)')
    // Filtrar admins con fcm_token para push notifications
    this.schema.raw('CREATE INDEX idx_users_fcm_token ON users (fcm_token)')

    // ── conductores ────────────────────────────────────────────────
    // Filtrar por online (GeoService, broadcast)
    this.schema.raw('CREATE INDEX idx_conductores_online ON conductores (online)')
    // Filtrar por estado_verificacion (admin panel)
    this.schema.raw('CREATE INDEX idx_conductores_estado_verificacion ON conductores (estado_verificacion)')
    // Ordenar por created_at en listados
    this.schema.raw('CREATE INDEX idx_conductores_created_at ON conductores (created_at)')
    // Geo query compuesto: conductores online con ubicación no nula
    this.schema.raw('CREATE INDEX idx_conductores_online_ubicacion ON conductores (online, ultima_ubicacion_lat, ultima_ubicacion_lng)')

    // ── viajes ────────────────────────────────────────────────────
    // Ya tiene idx_viajes_estado y idx_viajes_conductor (FK auto-index)
    // Buscar viaje activo por cliente (frecuente en trip_controller.request)
    this.schema.raw('CREATE INDEX idx_viajes_cliente_estado ON viajes (cliente_id, estado)')
    // Ordenar por created_at en history
    this.schema.raw('CREATE INDEX idx_viajes_created_at ON viajes (created_at)')
    // Filtrar por estado + created_at (dashboard admin)
    this.schema.raw('CREATE INDEX idx_viajes_estado_created ON viajes (estado, created_at)')

    // ── ofertas ───────────────────────────────────────────────────
    // Buscar ofertas por viaje + estado
    this.schema.raw('CREATE INDEX idx_ofertas_viaje_estado ON ofertas (viaje_id, estado)')
    // Buscar ofertas por conductor + estado
    this.schema.raw('CREATE INDEX idx_ofertas_conductor_estado ON ofertas (conductor_id, estado)')
    // Ordenar por created_at
    this.schema.raw('CREATE INDEX idx_ofertas_created_at ON ofertas (created_at)')

    // ── mensajes_chat ──────────────────────────────────────────────
    // Marcar como leídos por viaje
    this.schema.raw('CREATE INDEX idx_chat_viaje_leido ON mensajes_chat (viaje_id, leido)')
    // Ordenar mensajes por fecha
    this.schema.raw('CREATE INDEX idx_chat_created_at ON mensajes_chat (created_at)')

    // ── notificaciones ────────────────────────────────────────────
    // Listar notificaciones no leídas por usuario
    this.schema.raw('CREATE INDEX idx_notificaciones_usuario_leido ON notificaciones (usuario_id, leido)')
    // Ordenar notificaciones
    this.schema.raw('CREATE INDEX idx_notificaciones_created_at ON notificaciones (created_at)')

    // ── disputas ──────────────────────────────────────────────────
    // Filtrar por estado (admin panel filtra abiertas/en_revision)
    this.schema.raw('CREATE INDEX idx_disputas_estado ON disputas (estado)')
    // Ordenar por created_at
    this.schema.raw('CREATE INDEX idx_disputas_created_at ON disputas (created_at)')

    // ── calificaciones ────────────────────────────────────────────
    // Calcular promedio por calificado_id (frecuente)
    this.schema.raw('CREATE INDEX idx_calificaciones_calificado ON calificaciones (calificado_id)')
    // Filtrar por tipo
    this.schema.raw('CREATE INDEX idx_calificaciones_tipo ON calificaciones (tipo)')
    // Ordenar por created_at
    this.schema.raw('CREATE INDEX idx_calificaciones_created_at ON calificaciones (created_at)')

    // ── ganancias ─────────────────────────────────────────────────
    // Filtrar por conductor + rango de fechas (driver stats)
    this.schema.raw('CREATE INDEX idx_ganancias_conductor_created ON ganancias (conductor_id, created_at)')
    // Filtrar comisiones pendientes por conductor
    this.schema.raw('CREATE INDEX idx_ganancias_comision_pendiente ON ganancias (conductor_id, comision_pagada)')
    // Filtrar por created_at (dashboard)
    this.schema.raw('CREATE INDEX idx_ganancias_created_at ON ganancias (created_at)')
  }

  async down() {
    this.schema.raw('DROP INDEX IF EXISTS idx_users_rol ON users')
    this.schema.raw('DROP INDEX IF EXISTS idx_users_suspendido ON users')
    this.schema.raw('DROP INDEX IF EXISTS idx_users_estado_cuenta ON users')
    this.schema.raw('DROP INDEX IF EXISTS idx_users_created_at ON users')
    this.schema.raw('DROP INDEX IF EXISTS idx_users_fcm_token ON users')

    this.schema.raw('DROP INDEX IF EXISTS idx_conductores_online ON conductores')
    this.schema.raw('DROP INDEX IF EXISTS idx_conductores_estado_verificacion ON conductores')
    this.schema.raw('DROP INDEX IF EXISTS idx_conductores_created_at ON conductores')
    this.schema.raw('DROP INDEX IF EXISTS idx_conductores_online_ubicacion ON conductores')

    this.schema.raw('DROP INDEX IF EXISTS idx_viajes_cliente_estado ON viajes')
    this.schema.raw('DROP INDEX IF EXISTS idx_viajes_created_at ON viajes')
    this.schema.raw('DROP INDEX IF EXISTS idx_viajes_estado_created ON viajes')

    this.schema.raw('DROP INDEX IF EXISTS idx_ofertas_viaje_estado ON ofertas')
    this.schema.raw('DROP INDEX IF EXISTS idx_ofertas_conductor_estado ON ofertas')
    this.schema.raw('DROP INDEX IF EXISTS idx_ofertas_created_at ON ofertas')

    this.schema.raw('DROP INDEX IF EXISTS idx_chat_viaje_leido ON mensajes_chat')
    this.schema.raw('DROP INDEX IF EXISTS idx_chat_created_at ON mensajes_chat')

    this.schema.raw('DROP INDEX IF EXISTS idx_notificaciones_usuario_leido ON notificaciones')
    this.schema.raw('DROP INDEX IF EXISTS idx_notificaciones_created_at ON notificaciones')

    this.schema.raw('DROP INDEX IF EXISTS idx_disputas_estado ON disputas')
    this.schema.raw('DROP INDEX IF EXISTS idx_disputas_created_at ON disputas')

    this.schema.raw('DROP INDEX IF EXISTS idx_calificaciones_calificado ON calificaciones')
    this.schema.raw('DROP INDEX IF EXISTS idx_calificaciones_tipo ON calificaciones')
    this.schema.raw('DROP INDEX IF EXISTS idx_calificaciones_created_at ON calificaciones')

    this.schema.raw('DROP INDEX IF EXISTS idx_ganancias_conductor_created ON ganancias')
    this.schema.raw('DROP INDEX IF EXISTS idx_ganancias_comision_pendiente ON ganancias')
    this.schema.raw('DROP INDEX IF EXISTS idx_ganancias_created_at ON ganancias')
  }
}
