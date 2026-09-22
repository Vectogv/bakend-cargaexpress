# Despliegue de esta versión

Orden obligatorio: **1) backend → 2) panel web → 3) app móvil**.

El panel nuevo detecta si el backend todavía es el anterior y bloquea el guardado
de zonas, pero igual conviene respetar el orden. La app y el panel anteriores
siguen funcionando contra este backend, así que no hay ventana de caída.

## 1. Backend (Railway)

Rama: `mejoras/seguridad-y-limpieza`.

### Variables nuevas (todas opcionales)

| Variable | Para qué | Recomendación |
|---|---|---|
| `UPLOADS_DIR` | Carpeta de archivos subidos | Ruta del Volume, p. ej. `/data/uploads` |
| `METRICS_TOKEN` | Protege `/metrics` | Defínelo si algo la consulta; sin él responde 404 |
| `TRUST_PROXY_HOPS` | Proxies de confianza para el rate limit | `1` (valor por defecto en producción) |

Las que ya existían y siguen siendo necesarias: `APP_KEY`, `DB_HOST`, `DB_PORT`,
`DB_USER`, `DB_PASSWORD`, `DB_DATABASE`, `CORS_ORIGIN`, `REDIS_*`,
`FIREBASE_CREDENTIALS_PATH`, `MAPBOX_ACCESS_TOKEN`, `GOOGLE_SERVICE_ACCOUNT_KEY`,
`GOOGLE_DRIVE_FOLDER_ID`, `SENTRY_DSN`.

### Variables que faltan hoy en producción

| Variable | Estado actual | Consecuencia |
|---|---|---|
| `MAPBOX_ACCESS_TOKEN` | no existe | El mapa del panel de moderación no carga |
| `FIREBASE_CREDENTIALS_JSON` | no existe | Sin notificaciones push (start.sh no escribe el archivo) |
| `GOOGLE_SERVICE_ACCOUNT_KEY` | solo existe `GOOGLE_SERVICE_ACCOUNT_PATH` | Ya se acepta el alias; el archivo debe existir en el contenedor |
| `CORS_ORIGIN` | `https://tu-app.cargaexpress.com ...` (ejemplo, separado por espacios) | Debe listar los dominios reales separados por comas |

### Decisión pendiente: archivos subidos

Railway no permite un Volume en un servicio con más de una réplica, y
`railway.json` define `numReplicas: 2`. Hay que elegir:

- **Opción A (rápida):** bajar a 1 réplica, crear un Volume y definir `UPLOADS_DIR`.
- **Opción B (recomendada a futuro):** mover los archivos a S3 o Cloudflare R2 y
  mantener las 2 réplicas.

Sin una de las dos, cada réplica guarda sus propios archivos y un redeploy los borra.

### Antes de desplegar

1. Revisa que **todos los moderadores tengan `zona_moderador`**. Uno sin ciudad
   queda bloqueado a propósito (antes veía datos de todas las ciudades):
   ```sql
   SELECT id, email FROM users WHERE es_moderador = 1 AND (zona_moderador IS NULL OR zona_moderador = '');
   ```
2. El redeploy instala `postgresql-client` (nixpacks), necesario para los backups.

### Después de desplegar

1. `migration:run` corre solo dentro de `start.sh`.
2. Entra al panel → **Configuración → Cobertura** y define las ciudades. Sin zonas,
   la plataforma acepta viajes en cualquier lugar.
3. Comprueba: `GET /api/config/coverage` debe devolver las zonas activas.

## 2. Panel web (Vercel)

Rama: `rediseno/panel`. Variables:

| Variable | Para qué |
|---|---|
| `VITE_BACKEND_URL` | Sockets e imágenes. Sin ella usa la URL de Railway por defecto |
| `VITE_SENTRY_DSN` | Errores en Sentry (opcional) |

`vercel.json` ya reenvía `/api` al backend. Las llamadas HTTP pasan por ese proxy;
los sockets y las imágenes usan la URL absoluta.

## 3. App móvil

Rama: `mejoras/alineacion-y-rendimiento`.

```bash
flutter build apk --release --dart-define=PRODUCTION_URL=https://<backend>
flutter build web --release --dart-define=PRODUCTION_URL=https://<backend>   # para probar en navegador
```

En web funcionan el flujo de viajes, los sockets y los mapas. No funcionan el
servicio de ubicación en segundo plano ni las notificaciones push: eso solo se
prueba en un dispositivo.

## Verificación rápida tras el despliegue

```bash
curl https://<backend>/health                     # {"status":"ok"}
curl https://<backend>/api/config/coverage        # zonas activas
curl -o /dev/null -w "%{http_code}\n" https://<backend>/metrics   # 404 sin token
curl -o /dev/null -w "%{http_code}\n" https://<backend>/storage/uploads/cedula-1-x.png  # 403
```

Luego, en el panel: iniciar sesión, abrir Configuración → Cobertura, guardar una
zona y confirmar que aparece en `/api/config/coverage`.

## Pendiente conocido

- Las fotos de documentos de conductores siguen en el historial de git. Sacarlas
  exige reescribir la historia y un force-push.
- El chat de la pestaña Soporte en la app admin es una simulación local.
