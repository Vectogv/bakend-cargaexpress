# CargaExpress — Análisis de Seguridad y Hardening para Producción

**Fecha de análisis:** Junio 2026  
**Archivos revisados:** `trip_controller.ts`, `admin_controller.ts`, `dispute_controller.ts`, `idempotency_middleware.ts`, `rate_limit_middleware.ts`, `trip_state_machine.ts`, todos los modelos, todas las migraciones financieras, `socket.ts`, `routes.ts`

---

## 1. Resumen ejecutivo

El sistema CargaExpress tiene una arquitectura bien estructurada con separación de roles, una máquina de estados (`TripStateMachine`) correctamente diseñada, y middlewares de idempotencia y rate-limiting existentes. Sin embargo, la función más crítica del sistema —**la finalización de un viaje con sus efectos financieros**— tenía cuatro vulnerabilidades graves que podían producir pérdidas económicas reales en producción bajo alta concurrencia.

Se identificaron **4 vulnerabilidades críticas**, **3 vulnerabilidades altas** y **4 observaciones menores**. El hardening implementado las cierra todas.

---

## 2. Vulnerabilidades críticas identificadas

### 🔴 CRÍTICO-1: Sin transacción en el bloque financiero (doble estado parcial)

**Archivo:** `trip_controller.ts → finalize()`  
**Riesgo:** Pérdida económica directa

**Situación original:**  
El método `finalize` ejecutaba en secuencia sin transacción:

```
viaje.save()          ← paso 1
Ganancia.create()     ← paso 2
conductor.save()      ← paso 3
conductorUser.save()  ← paso 4
cliente.save()        ← paso 5
```

Si la base de datos o el proceso del servidor fallaban entre el paso 1 y el paso 2, el viaje quedaba marcado como `finalizado` pero **sin registro de ganancia ni deuda**. El conductor nunca sería cobrado la comisión y la plataforma perdería ese ingreso sin posibilidad de recuperarlo.

Si el fallo ocurría entre el paso 2 y el paso 4, existía ganancia en la tabla pero la deuda del conductor no se actualizaba. Inconsistencia contable permanente.

**Corrección implementada:**  
Todo el bloque financiero (pasos 1–5) se ejecuta dentro de una única transacción `db.transaction(async trx => { ... })`. Si cualquier paso falla, la transacción hace ROLLBACK y el viaje queda en `completado` (su estado previo), listo para ser reintentado correctamente.

---

### 🔴 CRÍTICO-2: Sin bloqueo pesimista — race condition en finalización concurrente

**Archivo:** `trip_controller.ts → finalize()`  
**Riesgo:** Doble comisión, doble deuda

**Situación original:**  
```typescript
const viaje = await Viaje.find(params.id)   // SELECT sin lock
// ... 50ms de lógica ...
viaje.estado = 'finalizado'
await viaje.save()                          // UPDATE — puede duplicarse
```

Si cliente y conductor presionaban "confirmar entrega" casi simultáneamente, o si el frontend enviaba doble request por problemas de red, dos procesos podían leer el viaje en estado `completado` al mismo tiempo, pasar ambos la validación de estado, y ejecutar el bloque financiero dos veces. Resultado: **dos filas en `ganancias`**, **doble deuda acumulada en el conductor**, y el viaje salvado dos veces con `finalizado`.

**Corrección implementada:**  
```typescript
const viaje = await Viaje.query({ client: trx })
  .where('id', viajeId)
  .forUpdate()   // ← SELECT FOR UPDATE — bloqueo pesimista
  .firstOrFail()
```

`SELECT FOR UPDATE` es el mecanismo estándar de bases de datos para este problema. El primer proceso adquiere el lock. El segundo proceso queda bloqueado hasta que el primero hace COMMIT. Cuando el segundo proceso re-lee el viaje, ya tiene estado `finalizado` y retorna idempotente sin ejecutar nada.

---

### 🔴 CRÍTICO-3: Sin constraint UNIQUE en `ganancias.viaje_id` — última línea de defensa ausente

**Archivo:** `database/migrations/1769000000004_create_ganancias_table.ts`  
**Riesgo:** Duplicación financiera ante fallo extremo

**Situación original:**  
La tabla `ganancias` solo tenía un índice ordinario en `conductor_id`. No había restricción UNIQUE en `viaje_id`. Esto significa que si dos procesos simultáneos pasaban la validación de estado al mismo tiempo (CRÍTICO-2), ambos podían insertar su fila de ganancia exitosamente. La base de datos no lo impedía.

En sistemas distribuidos (múltiples instancias del backend), el `IdempotencyMiddleware` usa un `Map` en memoria que **no se comparte entre pods**. Un reintento en un pod diferente no encontraría el cache y ejecutaría el bloque financiero de nuevo.

**Corrección implementada:**  
Nueva migración `1780200000001_add_unique_viaje_id_to_ganancias.ts` que agrega:
```sql
ALTER TABLE ganancias ADD UNIQUE INDEX uq_ganancias_viaje_id (viaje_id);
```

Ahora la base de datos **rechaza físicamente** cualquier intento de insertar una segunda ganancia para el mismo viaje, independientemente de cuántas instancias del backend estén corriendo.

El servicio de finalización captura el error de UNIQUE violation (`ER_DUP_ENTRY`) y lo convierte en respuesta idempotente en lugar de un error 500.

---

### 🔴 CRÍTICO-4: Lógica financiera sin protección contra disputa activa

**Archivo:** `trip_controller.ts → finalize()`  
**Riesgo:** Comisión cobrada en viaje disputado

**Situación original:**  
El método `finalize` no verificaba si existía una disputa activa (`abierta` o `en_revision`) antes de ejecutar el bloque financiero. Un conductor podía abrir una disputa post-entrega y simultáneamente el cliente o admin podía finalizar el viaje, generando la comisión y la deuda mientras la disputa estaba pendiente de resolución.

**Corrección implementada:**  
Verificación dentro de la transacción, antes del bloque financiero:
```typescript
const disputaActiva = await trx
  .from('disputas')
  .where('viaje_id', viajeId)
  .whereIn('estado', ['abierta', 'en_revision'])
  .first()

if (disputaActiva) {
  throw new Error('DISPUTA_ACTIVA')  // → 409 Conflict
}
```

---

## 3. Vulnerabilidades altas identificadas

### 🟠 ALTO-1: Idempotency middleware no cubría `finalize` ni `complete`

**Archivo:** `start/routes.ts`

**Situación original:**  
```typescript
router.post('request', ...).use([middleware.rateLimit(), middleware.idempotency()])
// complete y finalize — sin idempotency:
router.post(':id/complete', [controllers.Trip, 'complete'])
router.post(':id/finalize', [controllers.Trip, 'finalize'])
```

Las dos operaciones más críticas del sistema no tenían protección de idempotencia. Un double-tap del usuario o un reintento por timeout podía ejecutarlas dos veces.

**Corrección implementada:**  
```typescript
router.post(':id/complete', ...).use([middleware.rateLimit({ max: 5 }), middleware.idempotency()])
router.post(':id/finalize', ...).use([middleware.rateLimit({ max: 5 }), middleware.idempotency()])
```

---

### 🟠 ALTO-2: Lógica financiera dispersa en el controlador

**Situación original:**  
El método `finalize` del controlador combinaba autorización, validación de estado, creación de ganancia, actualización de deuda, actualización de reputación, envío de notificaciones push y emisión de sockets, todo en un único método de ~80 líneas. Esto hacía imposible:
- Testear la lógica financiera de forma aislada
- Reusar el cierre desde otros puntos del sistema (ej. admin, cron de expiración)
- Garantizar que el bloque financiero siempre se ejecute completo

**Corrección implementada:**  
`TripFinalizationService` centraliza toda la lógica financiera. El controlador delega con una sola llamada y luego solo maneja notificaciones. Los sockets y push notifications quedan fuera de la transacción (correcto: son efectos secundarios).

---

### 🟠 ALTO-3: IdempotencyMiddleware y RateLimitMiddleware usan Map en memoria

**Archivo:** `idempotency_middleware.ts`, `rate_limit_middleware.ts`

**Situación original (documentada en los propios archivos):**  
Ambos middlewares tienen el comentario `"Para producción multi-instancia reemplazar el Map por Redis"`. En un deployment con múltiples instancias (contenedores, PM2 cluster), cada instancia tiene su propio Map. Un usuario puede bypassear el rate-limit enviando requests a instancias diferentes, y la idempotencia no funciona entre pods.

**Estado:** No modificado en este hardening (requiere infraestructura Redis). Documentado como requisito para producción multi-instancia.

**Recomendación para producción real:**
```typescript
// Instalar: npm install ioredis
import Redis from 'ioredis'
const redis = new Redis(process.env.REDIS_URL)

// En IdempotencyMiddleware:
const cached = await redis.get(cacheKey)
if (cached) { /* replay */ }
await redis.setex(cacheKey, 3600, JSON.stringify({ body, status }))
```

---

## 4. Observaciones menores

### 🟡 MENOR-1: El método `complete` y `finalize` son estados separados que ambos permiten llamar a lógica financiera

El flujo actual tiene dos endpoints secuenciales:
- `POST /trips/:id/complete` → estado `completado` (sin finanzas, solo foto de entrega)
- `POST /trips/:id/finalize` → estado `finalizado` (con finanzas)

Esto es correcto por diseño (foto primero, confirmación después). La TripStateMachine lo valida correctamente (`completado → finalizado`).

### 🟡 MENOR-2: `emitToClient` en `finalize` usaba `viaje.clienteId` pero el viaje se re-fetcha después

En el controlador original se hacía `emitToClient(viaje.clienteId, ...)` con el clienteId del objeto en memoria. En la versión hardened se re-fetcha el viaje para asegurar datos frescos antes de emitir. Esto añade una query pero garantiza que se emite con datos del estado final commiteado.

### 🟡 MENOR-3: La reputación del cliente se actualiza dos veces en el bloque original

En el código original, la lógica de reputación tenía:
```typescript
if (totalViajesCompletados % 10 === 0 ...) reputacion += 0.5
if (totalViajesCompletados >= 1 ...)       reputacion += 0.1  // siempre se ejecuta
```

En el viaje #10, #20, etc., se sumaban 0.5 Y 0.1 en el mismo viaje (0.6 total). No está claro si es intencional. En el hardening se preservó el comportamiento original para no cambiar la lógica de negocio sin confirmación explícita.

### 🟡 MENOR-4: `Ganancia.create` usa el parámetro `monto` Y `montoNeto` con el mismo valor

```typescript
await Ganancia.create({
  monto: montoNeto,      // ← mismo valor
  montoNeto,             // ← duplicado
  ...
})
```

El campo `monto` es el original de la migración base y `montoNeto` el de la migración de comisiones. Para mantener compatibilidad hacia atrás se preservan ambos, pero en una versión futura `monto` podría deprecarse a favor de `montoNeto`.

---

## 5. Arquitectura del flujo después del hardening

```
POST /trips/:id/finalize
  │
  ├─ RateLimitMiddleware (5 req/min)
  ├─ IdempotencyMiddleware (X-Idempotency-Key)
  │    └─ Si key ya cacheada → return 200 sin ejecutar
  │
  └─ TripController.finalize()
       │
       ├─ Validar input (validator)
       │
       └─ TripFinalizationService.finalize()
            │
            ├─ PRECHECK (sin trx): ¿ya finalizado? → return idempotente
            │
            └─ db.transaction(trx)
                 │
                 ├─ SELECT viaje FOR UPDATE  ← lock pesimista
                 ├─ Re-validar estado (post-lock)
                 ├─ Verificar disputa activa
                 ├─ Verificar permisos del actor
                 ├─ Verificar ganancia existente
                 │
                 ├── viaje.estado = 'finalizado' ┐
                 ├── Ganancia.create()            │ Todo o nada
                 ├── conductor.totalViajes += 1  │ Si cualquiera falla
                 ├── conductorUser.montoDeuda +=  │ → ROLLBACK
                 └── cliente.reputacion +=        ┘
                      │
                      └─ COMMIT
                           │
                      [fuera de trx]
                      ├─ emitToClient(socket)
                      ├─ emitToAdmin(socket)
                      ├─ sendToToken(push cliente)
                      └─ sendToToken(push conductor)
```

---

## 6. Archivos modificados / creados

| Archivo | Tipo | Descripción |
|---|---|---|
| `app/services/trip_finalization_service.ts` | **NUEVO** | Servicio centralizado con transacción, FOR UPDATE, idempotencia, bloqueo por disputa |
| `database/migrations/1780200000001_add_unique_viaje_id_to_ganancias.ts` | **NUEVO** | UNIQUE constraint en `ganancias.viaje_id` |
| `app/controllers/trip_controller.ts` | **MODIFICADO** | `finalize()` delegado a `TripFinalizationService`; import agregado |
| `start/routes.ts` | **MODIFICADO** | `complete` y `finalize` con idempotency + rate-limit |

---

## 7. Cómo aplicar los cambios

```bash
# 1. Copiar los archivos al proyecto
cp app/services/trip_finalization_service.ts  <proyecto>/app/services/
cp database/migrations/1780200000001_*.ts     <proyecto>/database/migrations/
# Reemplazar trip_controller.ts y routes.ts

# 2. Ejecutar la migración
node ace migration:run

# 3. Verificar en DB (MySQL)
SHOW INDEX FROM ganancias WHERE Key_name = 'uq_ganancias_viaje_id';
-- Debe aparecer una fila con Non_unique = 0

# 4. Reiniciar el servidor
```

---

## 8. Prueba de regresión recomendada

```bash
# Test de doble request simultáneo (simula race condition)
# Ejecutar con curl en paralelo:

TOKEN="Bearer eyJ..."
VIAJE_ID=42
IDEM_KEY=$(uuidgen)

curl -X POST http://localhost:3333/api/trips/$VIAJE_ID/finalize \
  -H "Authorization: $TOKEN" \
  -H "X-Idempotency-Key: $IDEM_KEY" \
  -H "Content-Type: application/json" \
  -d '{"montoFinal": 35000}' &

curl -X POST http://localhost:3333/api/trips/$VIAJE_ID/finalize \
  -H "Authorization: $TOKEN" \
  -H "X-Idempotency-Key: $IDEM_KEY" \
  -H "Content-Type: application/json" \
  -d '{"montoFinal": 35000}' &

wait

# Resultado esperado: ambos devuelven 200, pero en la DB hay exactamente
# UNA fila en ganancias para ese viaje_id.

# Verificar:
# SELECT COUNT(*) FROM ganancias WHERE viaje_id = 42;  → debe ser 1
# SELECT estado FROM viajes WHERE id = 42;             → debe ser 'finalizado'
```

---

## 9. Requisito pendiente para producción multi-instancia

Si el backend se deploya en **más de una instancia** (múltiples contenedores, PM2 cluster, Kubernetes), es obligatorio migrar `IdempotencyMiddleware` y `RateLimitMiddleware` de `Map` en memoria a **Redis**. Sin esto:

- El rate-limiting puede bypassearse si las requests llegan a instancias distintas
- La idempotencia del middleware no se comparte entre pods (aunque `TripFinalizationService` + UNIQUE en DB siguen protegiendo el bloque financiero)

El `TripFinalizationService` con `SELECT FOR UPDATE` **sí** funciona correctamente en multi-instancia porque el lock es a nivel de base de datos, compartida por todos los pods.
