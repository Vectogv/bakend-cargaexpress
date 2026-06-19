# Deploy en Railway — CargaExpress GV

## Stack en Railway

```
Railway Project
├── Service: API (AdonisJS)
│   ├── Build: npm run build
│   ├── Start: cd build && node bin/server.js
│   └── Port: 3333
├── Service: MySQL 8.0 (Railway Plugin)
│   └── Internal connection via $MYSQL_URL
└── Service: Redis (Upstash o Railway Plugin)
    └── Internal connection via $REDIS_URL
```

## Variables de Entorno (Railway)

```env
# Obligatorias
NODE_ENV=production
PORT=3333
HOST=0.0.0.0
APP_KEY=<generado con: node ace generate:key>
APP_URL=https://cargaexpress-api.railway.app

# MySQL (Railway plugin expone automáticamente)
DB_HOST=${{ mysql.RAILWAY_INTERNAL_HOST }}
DB_PORT=${{ mysql.RAILWAY_INTERNAL_PORT }}
DB_USER=${{ mysql.MYSQLUSER }}
DB_PASSWORD=${{ mysql.MYSQLPASSWORD }}
DB_DATABASE=${{ mysql.MYSQLDATABASE }}
DB_SSL=false

# Redis (Railway plugin o Upstash)
REDIS_HOST=${{ redis.RAILWAY_INTERNAL_HOST }}
REDIS_PORT=${{ redis.RAILWAY_INTERNAL_PORT }}
REDIS_PASSWORD=

# Opcionales
SENTRY_DSN=
CORS_ORIGIN=https://app.cargaexpress.com
LOG_LEVEL=info
```

## Railway Configuration (railway.json)

Crear `railway.json` en la raíz:

```json
{
  "$schema": "https://railway.app/railway.schema.json",
  "build": {
    "builder": "nixpacks",
    "nixpacksPlan": {
      "phases": {
        "install": {
          "pkgs": ["nodejs_22"]
        }
      }
    },
    "buildCommand": "npm run build",
    "startCommand": "cd build && node bin/server.js",
    "watchPatterns": ["app/**", "config/**", "start/**", "bin/**"]
  },
  "deploy": {
    "numReplicas": 2,
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 10,
    "healthcheckPath": "/health",
    "healthcheckTimeout": 10
  }
}
```

## Límites Reales del Sistema para 1000 Usuarios Concurrentes

### 1. Conexiones MySQL
| Recurso | Límite | Nota |
|---------|--------|------|
| Pool conexiones | 25 por instancia | Railway MySQL soporta hasta 100 conexiones |
| Conexiones por request | ~2ms | Cada request usa 1 conexión del pool |
| Máximo teórico | ~12,500 requests/min | Con pool de 25 y queries promedio de 2ms |

### 2. Redis
| Recurso | Límite | Nota |
|---------|--------|------|
| Conexiones simultáneas | 10,000+ | Upstash soporta escalado automático |
| GPS rate limit keys | ~500 keys/min | 1 key por conductor cada 8s |
| Cache viajes activos | ~1,000 keys | TTL 120s |
| Socket state | ~1,000 keys | TTL 60s |
| **Memoria estimada** | <50MB | Para 1000 usuarios activos |

### 3. Socket.IO
| Recurso | Límite | Nota |
|---------|--------|------|
| Conexiones por instancia | ~500 | Limitado por Node.js event loop |
| Instancias recomendadas | 2-3 | Escalado horizontal con Redis adapter |
| Eventos por segundo | ~5,000 | Con 2 instancias de 2 vCPU |
| Latencia típica | <50ms | Misma región Railway |

### 4. GPS (el cuello de botella principal)
| Recurso | Límite | Nota |
|---------|--------|------|
| GPS updates/segundo | ~125 (1000/8s) | Rate limit de 8s por conductor |
| GPS updates/segundo (400 conductores) | ~50 | Cálculo realista para 1000 usuarios mixtos |
| Escrituras MySQL GPS/hora | ~18,000 | UbicacionDriver inserts |
| **Impacto en DB** | Bajo | 1 insert cada 8s por conductor activo |
| **Impacto en API** | Bajo | Rate limit evita picos |

### 5. Estimación de recursos para 1000 usuarios
| Recurso | Estimado | Railway Free/Pro |
|---------|----------|------------------|
| CPU promedio | 0.5-1 vCPU por instancia | 2 vCPU × 2 instancias ✅ |
| RAM promedio | 256-512MB por instancia | 2GB × 2 instancias ✅ |
| Ancho de banda | ~10 Mbps | Ilimitado ✅ |
| Storage DB | ~2GB/mes | 10GB ✅ |
| Conexiones Socket | ~500 por instancia | 2 instancias cubre 1000 ✅ |

## Recomendaciones para Evitar Caídas

### 1. **Usar Redis sí o sí**
- Railway no garantiza que las instancias compartan memoria
- Redis Adapter para Socket.IO es obligatorio con >1 instancia
- Rate limit, idempotency, locks, todo debe ir a Redis

### 2. **Pool de conexiones MySQL ajustado**
```env
DB_POOL_MIN=2
DB_POOL_MAX=25
```
No usar `pool.max > 50` — Railway MySQL tiene límite de conexiones.

### 3. **Rate limit en endpoints críticos**
| Endpoint | Límite | Ventana |
|----------|--------|---------|
| `/api/auth/login` | 10 | 60s |
| `/api/trips/request` | 5 | 60s |
| `/api/trips/:id/offer` | 10 | 60s |
| `/api/trips/:id/complete` | 5 | 60s |
| GPS location | 1 | 8s |

### 4. **Graceful degradation**
- Si Redis falla → middleware usa RedisService que cae a Map en memoria
- Si Socket.IO falla → eventos se pierden pero API sigue funcionando
- Viajes se procesan con `FOR UPDATE` lock en MySQL

### 5. **Alertas recomendadas**
- Error rate > 1% en cualquier endpoint
- Latencia p95 > 2s
- Conexiones MySQL > 80% del pool
- Redis memory > 80%

## Railway Health Endpoint

```bash
curl https://cargaexpress-api.railway.app/health
# → { "status": "ok", "checks": { "database": "ok", "redis": "ok" } }
```

## Comandos Rápidos

```bash
# Ver logs
railway logs --service api

# Escalar instancias
railway scale api 3

# Ejecutar migraciones
railway run node ace migration:run --force

# Ver métricas
curl https://cargaexpress-api.railway.app/metrics | grep cargaexpress_

# Health check
curl https://cargaexpress-api.railway.app/health
```

## Mejores Prácticas Railway

1. **Siempre 2+ instancias** — Railway hace deploys rolling, si tienes 1 instancia hay downtime
2. **Health check en /health** — Railway lo usa para saber si la instancia está viva
3. **Migraciones manuales** — No usar `migration:run --force` en startup; ejecutar manualmente después del deploy
4. **Logs a salida estándar** — Railway captura stdout automáticamente
5. **No usar disco local** — El filesystem no persiste entre deploys (subir archivos a S3/Cloudinary)
