# ESTABILIZACIÓN COMPLETA — CARGAEXPRESS GV

**Fecha:** Julio 2026
**Branch backend:** `FlujoDiego`
**Branch frontend:** `FlujoDiego` (cambios locales)

---

## RESUMEN

Se ejecutaron las 7 fases del plan de estabilización sobre el backend (AdonisJS) y frontend (Flutter), eliminando estados fantasma, sincronizando eventos socket entre ambas plataformas, y corrigiendo bugs críticos.

---

## FASE 1 — Base de Datos

### Migración: `VARCHAR(20)` → `VARCHAR(30)` en columna `estado`

**Archivo:** `database/migrations/1782535860419_alter_viajes_estado_length.ts`

**Problema:** El estado `'esperando_confirmacion'` mide 22 caracteres, pero la columna estaba definida como `VARCHAR(20)`. Esto provocaba que el `UPDATE` truncara el estado silenciosamente, dejando viajes en un limbo.

**Solución:** Migración que altera la columna `estado` en la tabla `viajes` a `VARCHAR(30)`.

### Migraciones existentes (ya en `FlujoDiego`)

- `1782535860417_add_motivo_to_alertas_emergencia.ts` — Agrega columna `motivo` a `alertas_emergencia`
- `1782535860418_add_expira_at_to_ofertas.ts` — Agrega columna `expira_at` a `ofertas`

---

## FASE 2 — Contrato Compartido

### Archivos creados

| Archivo | Propósito |
|---------|-----------|
| `contracts/trip_status.ts` | 14 estados de viaje definitivos como constantes |
| `contracts/socket_events.ts` | 12 eventos socket oficiales como constantes |

### Estados de Viaje Definitivos

```
creado → buscando_conductor → pendiente → aceptado → 
conductor_en_camino → conductor_llegada → en_curso → 
entregado → esperando_confirmacion → finalizado
         ↘ cancelado / rechazado / sos / disputa ↗
```

### Eventos Socket Oficiales

| Evento | Propósito |
|--------|-----------|
| `trip:status_changed` | Cambio de estado del viaje (evento universal) |
| `offer:accepted` | Oferta aceptada |
| `new:offer` | Nueva oferta recibida |
| `driver:on_the_way` | Conductor en camino al origen |
| `driver:arrived` | Conductor llegó al origen |
| `trip:started` | Viaje iniciado |
| `trip:finalized` | Viaje finalizado |
| `trip:cancelled` | Viaje cancelado |
| `chat:message` | Mensaje de chat |
| `sos:activated` | Emergencia activada |
| `payment:confirmed` | Pago confirmado |
| `payment:rejected` | Pago rechazado |

---

## FASE 3 — Limpieza de Estados Fantasma

### Estados eliminados

| Estado | Motivo | Archivos modificados |
|--------|--------|----------------------|
| `completado` | Nunca lo asigna ningún controlador | trip_state_machine, trip_controller, trip_finalization_service, dispute_controller, admin_controller, 4 tests |
| `ofertas_recibidas` | Nunca lo asigna ningún controlador | trip_state_machine, trip_controller, offer_controller |
| `conductor_aceptado` | Estado intermedio innecesario, simplificado a `aceptado` → `conductor_en_camino` | trip_state_machine, trip_controller, offer_controller |

### Flujo de estados antes vs después

**Antes (17 estados):**
```
creado → buscando_conductor → pendiente → ofertas_recibidas → aceptado →
conductor_aceptado → conductor_en_camino → conductor_llegada → en_curso →
completado → entregado → esperando_confirmacion → completado → finalizado
```

**Después (14 estados):**
```
creado → buscando_conductor → pendiente → aceptado →
conductor_en_camino → conductor_llegada → en_curso →
entregado → esperando_confirmacion → finalizado
```

### Cambios en `trip_state_machine.ts`

- Eliminados: `ofertas_recibidas`, `conductor_aceptado`, `completado` del type
- Simplificadas las transiciones eliminando rutas a estados fantasma
- Transición `en_curso` → `entregado` (directo, sin `completado`)
- Transición `esperando_confirmacion` → `finalizado` (directo, sin `completado`)

### Cambios en `trip_controller.ts`

- Línea 40: `whereIn` de viaje activo simplificado
- Línea 219: `whereIn` de conductor activo simplificado
- Línea 226: `whereIn` de cliente activo simplificado
- Línea 283: validación de accept cambió de `['buscando_conductor', 'ofertas_recibidas']` a `['buscando_conductor', 'pendiente']`
- Línea 291: `viaje.estado = 'conductor_aceptado'` → `viaje.estado = 'aceptado'`
- Línea 323: emit cambió de `'conductor_aceptado'` a `'aceptado'`
- Línea 650: validación de distancia en cancelación simplificada
- Línea 670: penalización de reputación simplificada
- Línea 1008: `deliveryPhoto` cambió de `['en_curso', 'completado']` a `['en_curso', 'entregado']`

### Cambios en `offer_controller.ts`

- Línea 190: validación de accept simplificada
- Líneas 321-329: `confirmArrival` simplificado (eliminado paso intermedio)

### Cambios en `dispute_controller.ts`

- Líneas 53 y 178: eliminado `completado` de estados válidos para disputas

### Cambios en `trip_finalization_service.ts`

- Línea 152: mensaje de error actualizado (eliminada referencia a `completado`)

### Cambios en `admin_controller.ts`

- Línea 46: `whereIn` cambió de `['completado', 'finalizado']` a `['finalizado']`

### Cambios en tests

| Archivo | Cambio |
|---------|--------|
| `tests/functional/trip_flow.spec.ts` | `'completado'` → `'esperando_confirmacion'` (2 ocurrencias) |
| `tests/functional/failure_simulation.spec.ts` | `'completado'` → `'esperando_confirmacion'` |
| `tests/functional/socket_reconnection.spec.ts` | `'completado'` → `'esperando_confirmacion'` |

---

## FASE 4 — Sincronización de Eventos Socket

### `trip:status_changed` agregado donde faltaba

| Transición | Estado | Dónde se agregó |
|------------|--------|-----------------|
| Rechazar viaje | `rechazado` | `trip_controller.ts:451` (antes solo emitía `trip:declined`) |
| Finalizar viaje | `finalizado` | `trip_controller.ts:556` (antes solo emitía `trip:finalized`) |

### Bug corregido: `emitToDriver`

**Archivo:** `app/controllers/trip_controller.ts:353`

**Antes:**
```typescript
emitToDriver(resultado.viaje.clienteId, 'trip:offer_accepted', { ... })
```

**Después:**
```typescript
emitToDriver(resultado.viaje.conductor.usuarioId, 'trip:offer_accepted', { ... })
```

**Problema:** Se estaba emitiendo al `clienteId` en vez del `usuarioId` del conductor. El conductor nunca recibía el evento de oferta aceptada.

### Null safety: `aceptadoAt`

- Líneas 334, 350, 375: `aceptadoAt.toISO()` → `aceptadoAt?.toISO() ?? null`

### Import no usado

- `emergency_controller.ts`: eliminado `getIO` de los imports

---

## FASE 5 — Frontend Flutter

### 5.1 Contratos creados

| Archivo | Propósito |
|---------|-----------|
| `lib/contracts/trip_status.dart` | Clase `TripStatus` con 14 constantes de estado |
| `lib/contracts/socket_events.dart` | Clase `SocketEvents` con 12 constantes de eventos |

### 5.2 `socket_service_client.dart`

**Nuevos StreamControllers:**
- `_driverOnWayCtrl` / `onDriverOnWay` — para `driver:on_the_way`
- `_driverArrivedCtrl` / `onDriverArrived` — para `driver:arrived`
- `_sosActivatedCtrl` / `onSosActivated` — para `sos:activated`

**Nuevos listeners agregados:**
- `trip:status_changed` → mismo stream que `trip:status` (backward compatible)
- `chat:message` → mismo stream que `message:new` (backward compatible)
- `driver:on_the_way` → nuevo stream
- `driver:arrived` → nuevo stream
- `sos:activated` → nuevo stream

**Refactor:** Método `_incrementChatUnreadIfOther()` extraído para reutilización en ambos listeners de chat.

### 5.3 `trip_model.dart`

- `isActive`: actualizado para usar `TripStatus.cancelado`, `.finalizado`, `.rechazado`
- `estadoLabel`: 14 casos con labels descriptivos
- `estadoColor`: 14 casos con colores distintivos

### 5.4 Screens de cliente

| Archivo | Cambio |
|---------|--------|
| `rastreo_screen.dart` | `'completado'` → `'entregado'` / `'esperando_confirmacion'` |
| `home_screen.dart` | `'completado'` → `'esperando_confirmacion'` |

### 5.5 Screens de conductor

| Archivo | Cambio |
|---------|--------|
| `trip_in_progress_screen.dart` | `_isTripActive` con nuevos estados; stepper actualizado a 7 pasos; botón de finalización con `'esperando_confirmacion'` |
| `trip_chat_screen.dart` | `_canChat` con nuevos estados (2 ocurrencias) |
| `offers_screen.dart` | Badge y status banner `'completado'` → `'esperando_confirmacion'` |
| `home_screen.dart` | Condición de notificación `'completado'` → `'esperando_confirmacion'` / `'finalizado'` |
| `trip_history_screen.dart` | Badge `'completado'` → `'esperando_confirmacion'` |

### 5.6 Screens de admin

| Archivo | Cambio |
|---------|--------|
| `admin_live_screen.dart` | Color `'completado'` → `'esperando_confirmacion'` |
| `gestion_viajes_screen.dart` | Filtro, label y color `'completado'` → `'esperando_confirmacion'` |

### 5.7 Servicios

| Archivo | Cambio |
|---------|--------|
| `fraud_detection_service.dart` | Transiciones actualizadas: `aceptado→completado` → `aceptado→conductor_en_camino`, `en_curso→completado` → `en_curso→entregado` |

---

## ARCHIVOS MODIFICADOS — BACKEND

```
app/services/trip_state_machine.ts
app/controllers/trip_controller.ts
app/controllers/offer_controller.ts
app/controllers/dispute_controller.ts
app/controllers/emergency_controller.ts
app/controllers/admin_controller.ts
app/services/trip_finalization_service.ts
contracts/trip_status.ts                        (nuevo)
contracts/socket_events.ts                      (nuevo)
database/migrations/1782535860419_alter_viajes_estado_length.ts  (nuevo)
package.json
tests/functional/trip_flow.spec.ts
tests/functional/failure_simulation.spec.ts
tests/functional/socket_reconnection.spec.ts
```

## ARCHIVOS MODIFICADOS — FRONTEND

```
lib/contracts/trip_status.dart                  (nuevo)
lib/contracts/socket_events.dart                (nuevo)
lib/services/socket_service_client.dart
lib/models/trip_model.dart
lib/screens/cliente/rastreo_screen.dart
lib/screens/cliente/home_screen.dart
lib/screens/conductor/trip_in_progress_screen.dart
lib/screens/conductor/trip_chat_screen.dart
lib/screens/conductor/offers_screen.dart
lib/screens/conductor/home_screen.dart
lib/screens/conductor/trip_history_screen.dart
lib/screens/admin/admin_live_screen.dart
lib/screens/admin/gestion_viajes_screen.dart
lib/services/fraud_detection_service.dart
```

---

## VERIFICACIÓN

- **Backend:** `npx tsc --noEmit` — sin errores en archivos modificados
- **Frontend:** `flutter analyze` — 0 errores, solo warnings pre-existentes
