# CargaExpress GV — Arquitectura Escalable

## Diagrama de Arquitectura

```
                                  ┌─────────────────────────┐
                                  │     Cloudflare / DNS     │
                                  │   (proxy, SSL, DDoS)     │
                                  └──────────┬──────────────┘
                                             │
                                  ┌──────────▼──────────────┐
                                  │   Load Balancer (HAProxy │
                                  │    / Nginx / AWS ALB)    │
                                  └──────────┬──────────────┘
                                             │
                    ┌────────────────────────┼────────────────────────┐
                    │                        │                        │
           ┌────────▼────────┐     ┌────────▼────────┐     ┌────────▼────────┐
           │  AdonisJS Node 1 │     │  AdonisJS Node 2 │     │  AdonisJS Node N │
           │  (instancia A)   │     │  (instancia B)   │     │  (instancia C)   │
           │                  │     │                  │     │                  │
           │  ┌────────────┐  │     │  ┌────────────┐  │     │  ┌────────────┐  │
           │  │ Sentry     │  │     │  │ Sentry     │  │     │  │ Sentry     │  │
           │  │ (errores)  │  │     │  │ (errores)  │  │     │  │ (errores)  │  │
           │  └────────────┘  │     │  └────────────┘  │     │  └────────────┘  │
           │  ┌────────────┐  │     │  ┌────────────┐  │     │  ┌────────────┐  │
           │  │ Prometheus │  │     │  │ Prometheus │  │     │  │ Prometheus │  │
           │  │ (métricas) │  │     │  │ (métricas) │  │     │  │ (métricas) │  │
           │  └────────────┘  │     │  └────────────┘  │     │  └────────────┘  │
           └────────┬────────┘     └────────┬────────┘     └────────┬────────┘
                    │                        │                        │
                    └────────────────────────┼────────────────────────┘
                                             │
                    ┌────────────────────────┼────────────────────────┐
                    │                        │                        │
           ┌────────▼────────┐     ┌────────▼────────┐     ┌────────▼────────┐
           │  Redis Cluster   │     │   MySQL 8.0      │     │   Loki +        │
           │  (sesiones,      │     │   (Primary +     │     │   Promtail      │
           │   cache, locks,  │     │    Replicas)     │     │   (logs)        │
           │   rate limit)    │     │                  │     │                 │
           │   Puertos:       │     │   Puertos:       │     │                 │
           │   6379, 6380     │     │   3306, 3307     │     │   Puertos:      │
           │                  │     │                  │     │   3100, 9080    │
           └──────────────────┘     └──────────────────┘     └──────────────────┘
                    │                        │                        │
                    └────────────────────────┼────────────────────────┘
                                             │
                                  ┌──────────▼──────────────┐
                                  │     Grafana Dashboard    │
                                  │  (Prometheus + Loki)     │
                                  │  Métricas + Logs +       │
                                  │  Trazas (Sentry)         │
                                  └─────────────────────────┘
```

## Stack Tecnológico

| Componente        | Tecnología                          | Versión      |
|-------------------|-------------------------------------|--------------|
| Backend           | AdonisJS (Node.js)                  | 7.x          |
| Base de datos     | MySQL                               | 8.0+         |
| Cache / Sesiones  | Redis                               | 7.x          |
| Tiempo real       | Socket.IO                           | 4.x          |
| Logs              | Pino (estructurado JSON)            | 10.x         |
| Errores           | Sentry                              | 9.x          |
| Métricas          | Prometheus (prom-client)            | 15.x         |
| Dashboards        | Grafana                             | 11.x         |
| Load balancer     | HAProxy / Nginx / AWS ALB           | -            |
| Logs shipping     | Promtail + Loki (opcional)          | 3.x          |

## Estrategia de Escalado Horizontal

### 1. Múltiples instancias AdonisJS
- Cada instancia es stateless (el estado vive en Redis y MySQL)
- Escalar horizontalmente: `systemd --user` + PM2 cluster mode o Docker/K8s
- Socket.IO requiere Redis Adapter para broadcast entre instancias:
  ```
  npm install @socket.io/redis-adapter ioredis
  ```
  ```ts
  // start/socket.ts
  import { createAdapter } from '@socket.io/redis-adapter'
  import Redis from 'ioredis'
  const pubClient = new Redis(/* ... */)
  const subClient = pubClient.duplicate()
  io.adapter(createAdapter(pubClient, subClient))
  ```

### 2. Balanceador de carga
- Sticky sessions NO necesarias (todo el estado está en Redis)
- Health check: `GET /health` → 200 OK
- Timeout: 30s para requests, 120s para WebSocket upgrade

### 3. Redis centralizado
- Usar Redis Cluster o ElastiCache (AWS) para alta disponibilidad
- Todas las operaciones críticas usan `RedisService` con fallback a memoria
- Keys con TTL automático para evitar acumulación

### 4. MySQL optimizado
```sql
-- Índices recomendados (ya deben existir)
ALTER TABLE viajes ADD INDEX idx_viajes_estado_conductor (estado, conductor_id);
ALTER TABLE viajes ADD INDEX idx_viajes_cliente_estado (cliente_id, estado);
ALTER TABLE conductores ADD INDEX idx_conductores_ubicacion (ultima_lat, ultima_lng);
ALTER TABLE logs_fraude ADD INDEX idx_fraude_conductor (conductor_id, created_at);
```
- Connection pool: mínimo 10, máximo 50 por instancia
- Read replicas para consultas de solo lectura (reportes, historial)

### 5. Socket.IO en cluster
- Redis Adapter para emitir eventos entre instancias
- Namespaces por rol: `driver:{id}`, `client:{id}`, `admin`
- Heartbeat cada 25s, timeout a 60s

## Configuración de Producción

### Variables de Entorno (.env)
```env
NODE_ENV=production
PORT=3333
HOST=0.0.0.0
LOG_LEVEL=info

# App
APP_KEY=long-random-key-32-chars
APP_URL=https://api.cargaexpress.com

# DB
DB_HOST=mysql-primary.cargaexpress.com
DB_PORT=3306
DB_USER=cargaexpress
DB_PASSWORD=secure-password
DB_DATABASE=cargaexpress
DB_POOL_MIN=2
DB_POOL_MAX=20

# Redis
REDIS_HOST=redis-cluster.cargaexpress.com
REDIS_PORT=6379
REDIS_PASSWORD=secure-redis-password

# Sentry
SENTRY_DSN=https://xxxxxxxxx@sentry.io/xxxxx

# CORS
CORS_ORIGIN=https://app.cargaexpress.com,https://admin.cargaexpress.com
```

### PM2 Ecosystem (ecosystem.config.cjs)
```js
module.exports = {
  apps: [{
    name: 'cargaexpress-api',
    script: 'bin/server.js',
    instances: 'max',
    exec_mode: 'cluster',
    env: { NODE_ENV: 'production' },
    max_memory_restart: '1G',
    error_file: './storage/logs/pm2-error.log',
    out_file: './storage/logs/pm2-out.log',
    merge_logs: true,
    listen_timeout: 8000,
    kill_timeout: 5000,
  }]
}
```

### Systemd (opcional, sin PM2)
```ini
[Unit]
Description=CargaExpress API
After=network.target mysql.service redis.service

[Service]
Type=exec
User=node
WorkingDirectory=/opt/cargaexpress
ExecStart=/usr/bin/node bin/server.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production
Environment=PORT=3333
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
```

## Riesgos y Soluciones

| Riesgo                           | Probabilidad | Impacto | Solución                                      |
|----------------------------------|-------------|---------|-----------------------------------------------|
| Redis caído                      | Baja        | Medio   | Fallback automático a Map en memoria           |
| Pico de GPS updates (>1000/s)   | Media       | Alto    | Rate limit de 8s + cola de mensajería          |
| Doble asignación de viaje        | Baja        | Crítico | `FOR UPDATE` + Redis lock en aceptación        |
| Socket.IO desconexión masiva     | Baja        | Alto    | Reconexión automática + emits seguros (try/catch) |
| MySQL conexiones agotadas        | Media       | Alto    | Pool limitado + read replicas + monitoreo       |
| Token JWT robado                 | Baja        | Medio   | Blacklist en Redis + rotación de tokens         |
| Fraude GPS (ubicación falsa)     | Media       | Medio   | Detección con 5 reglas + logging no-blocking   |
| Memoria llena (fallback Map)     | Baja        | Medio   | TTL automático en todas las keys del Map        |

## Checklist de Deploy

### Pre-deploy
- [ ] Ejecutar `npm run build` (comprobado: build exitoso)
- [ ] Ejecutar tests: `npm test` (66 tests, todos pasan)
- [ ] Verificar migraciones: `node ace migration:run`
- [ ] Configurar Redis y verificar conexión
- [ ] Configurar Sentry DSN en `.env`
- [ ] Verificar variables de entorno completas
- [ ] Health check: `GET /health` → 200
- [ ] Metrics check: `GET /metrics` → texto Prometheus

### Deploy
- [ ] `git pull origin main` en servidor
- [ ] `npm ci --omit=dev` (instalar solo producción)
- [ ] `node ace migration:run --force` (ejecutar migraciones)
- [ ] Iniciar con PM2: `pm2 start ecosystem.config.cjs`
- [ ] Verificar logs: `pm2 logs cargaexpress-api --lines 50`
- [ ] Verificar Sentry: generar error de prueba y confirmar captura

### Post-deploy (monitoreo)
- [ ] Revisar dashboard Grafana (métricas cada 15s)
- [ ] Configurar alertas:
  - Error rate > 1% → PagerDuty/Slack
  - CPU > 80% → autoescalar
  - Redis memory > 80% → alerta
  - Latencia p99 > 2s → revisar queries
- [ ] Ejecutar load test: `artillery run tests/load/production_simulation.yml`
- [ ] Verificar Socket.IO: conectarse desde cliente real
- [ ] Verificar GPS rate limit: actualizar ubicación >8s

### Rollback
- [ ] `pm2 reload ecosystem.config.cjs --env production` (versión anterior)
- [ ] Si hay migraciones: `node ace migration:rollback`
- [ ] Verificar health endpoint

## Dashboards Sugeridos (Grafana)

### Panel 1: Resumen General
- HTTP requests/min (gráfico de áreas)
- Latencia p50, p95, p99 (líneas)
- Sockets activos (gauge)
- Errores/min (contador)

### Panel 2: GPS y Conductores
- GPS updates/min
- GPS rate limited/min
- Fraudes detectados por tipo (pastel)
- Conductores activos ahora (gauge)

### Panel 3: Base de Datos
- Conexiones activas MySQL
- Query duration p50/p95
- Trips creados vs completados (barras)

### Panel 4: Sistema
- CPU por instancia
- RAM por instancia
- Redis memory used
- Uptime

### Panel 5: Logs (Loki)
- Error rate timeline
- Búsqueda por `tipoFraude`, `userId`, `conductorId`
- Logs de autenticación fallidos

## Comandos de Ejecución

```bash
# Build
npm run build

# Producción (Node directo)
cd build && NODE_ENV=production node bin/server.js

# Producción (PM2)
pm2 start ecosystem.config.cjs

# Load test
artillery run tests/load/production_simulation.yml

# Ver métricas
curl http://localhost:3333/metrics

# Health check
curl http://localhost:3333/health

# Logs en tiempo real (producción)
tail -f storage/logs/app.log

# Backup BD
mysqldump -u root cargaexpress > backup_$(date +%Y%m%d).sql
```
