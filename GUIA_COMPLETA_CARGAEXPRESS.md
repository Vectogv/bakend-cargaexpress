# GUÍA COMPLETA DE ESTABILIZACIÓN Y SINCRONIZACIÓN

## CARGAEXPRESS GV — BACKEND (ADONIS) + FRONTEND (FLUTTER)

**Versión:** 2.0 (Fusión Full-Stack)
**Fecha:** Julio 2026
**Objetivo:** Pasar de un sistema inconsistente y con tiempo real roto a una plataforma estable, sincronizada y lista para producción en 72 horas.

---

## 1. DIAGNÓSTICO: ¿POR QUÉ EL SISTEMA NO FUNCIONA COMO DEBERÍA?

El sistema tiene una base de código sólida (buena arquitectura en el backend con TripStateMachine y servicios de finalización), pero sufre de **3 fallas estructurales graves** que lo invalidan para producción:

1. **La Base de Datos no soporta el propio flujo de la aplicación.**
   La columna `estado` está definida como `VARCHAR(20)`, pero el estado `'esperando_confirmacion'` mide **22 caracteres**. Esto provoca que el `UPDATE` falle silenciosamente (o trunque el estado), dejando los viajes en un limbo del que nunca pueden salir.

2. **El "Tiempo Real" es un espejismo.**
   Backend y Frontend hablan idiomas distintos. Mientras el backend emite `trip:status_changed`, el frontend escucha `trip:status`. El backend emite `chat:message`, el frontend escucha `message:new`. Esto significa que las actualizaciones de estado, el chat y el tracking del conductor **no llegan al usuario en tiempo real**.

3. **Hay estados "fantasma" que confunden la lógica.**
   `completado` y `ofertas_recibidas` están definidos en el código y en la máquina de estados, pero ningún controlador los asigna. Esto genera confusión en el frontend y ramas de lógica que nunca se ejecutan, además de exponer el sistema a bugs de validación.

---

## 2. LA SOLUCIÓN: EL "IDIOMA OFICIAL DEL SISTEMA" (EL CONTRATO)

Para acabar con los mismatches y la confusión, necesitamos una **fuente única de verdad** que ambos proyectos (backend y frontend) importen. No más strings mágicos escritos a mano.

### 2.1. Definición de Estados de Viaje (Depurados y Definitivos)

Eliminamos los fantasmas (`completado`, `ofertas_recibidas`, `conductor_aceptado`) y nos quedamos con los estados reales que fluyen en producción:

```typescript
// contracts/contract.v1.ts
export const TRIP_STATUS = {
  CREADO: "creado",
  BUSCANDO: "buscando_conductor",
  PENDIENTE: "pendiente",
  ACEPTADO: "aceptado",
  EN_CAMINO: "conductor_en_camino",
  LLEGADA: "conductor_llegada",
  EN_CURSO: "en_curso",
  ENTREGADO: "entregado",
  ESPERA_CONFIRMACION: "esperando_confirmacion",
  FINALIZADO: "finalizado",
  CANCELADO: "cancelado",
  RECHAZADO: "rechazado",
  DISPUTA: "disputa",
  SOS: "sos"
} as const;
```

### 2.2. Definición de Eventos Socket (Unificados)

Estos son los nombres que deben coincidir **exactamente** en el `emit` del backend y en el `.on` del frontend.

```typescript
// contracts/socket.events.ts
export const SOCKET_EVENTS = {
  TRIP_STATUS: "trip:status_changed",
  OFFER_ACCEPTED: "offer:accepted",
  NEW_OFFER: "new:offer",
  DRIVER_ON_WAY: "driver:on_the_way",
  DRIVER_ARRIVED: "driver:arrived",
  TRIP_STARTED: "trip:started",
  TRIP_FINALIZED: "trip:finalized",
  TRIP_CANCELLED: "trip:cancelled",
  CHAT_MESSAGE: "chat:message",
  SOS: "sos:activated",
  PAYMENT_OK: "payment:confirmed",
  PAYMENT_FAIL: "payment:rejected"
} as const;
```

---

## 3. PLAN DE ACCIÓN (72 HORAS)

### FASE 1 — Base de Datos (4 horas)

1. **Agrandar `VARCHAR(estado)` a `VARCHAR(30)`** para que entre `esperando_confirmacion` sin truncar.
2. **Agregar `expira_at` a `ofertas`** (migración lista en `FlujoDiego`).
3. **Agregar `motivo` a `alertas_emergencia`** (migración lista en `FlujoDiego`).
4. Verificar que el `down` de las migraciones funcione correctamente.

### FASE 2 — Contrato Compartido (6 horas)

1. Crear carpeta `contracts/` en la raíz del backend.
2. Crear `contracts/trip_status.ts` y `contracts/socket_events.ts` con las definiciones de arriba.
3. Refactorizar el backend para **importar** estas constantes en vez de usar strings hardcodeados.
4. Publicar estos archivos (o copiarlos) al frontend Flutter.

### FASE 3 — Backend: Limpieza de Estados Fantasma (8 horas)

1. Eliminar `ofertas_recibidas` de `TripStateMachine` y de todas las validaciones.
2. Eliminar `completado` de `TripStateMachine` y del flujo de finalización.
3. Eliminar `conductor_aceptado` (el flujo debe ir de `aceptado` → `conductor_en_camino` directamente, o mantenerlo como transición intermedia únicamente en el backend pero no exponerlo al frontend).
4. Asegurar que ningún controlador asigne estados que no existen en la máquina.

### FASE 4 — Backend: Sincronización de Eventos Socket (12 horas)

1. Inventariar todos los `emit()` del backend y compararlos con los `.on()` del frontend.
2. Para cada mismatch:
   - Si el backend emite un evento que el frontend no escucha → agregar el `.on()` en el frontend.
   - Si el frontend escucha un nombre viejo → cambiarlo por el nombre oficial del contrato.
   - Si el backend emite con datos incompletos → completar el payload.
3. Verificar que todos los `emit` importantes tengan su correspondiente `trip:status_changed` como respaldo genérico.

### FASE 5 — Frontend: Consumir el Contrato (14 horas)

1. Reemplazar todos los strings hardcodeados de estados por las constantes importadas.
2. Unificar los listeners de socket:
   - `trip:status` → `trip:status_changed`
   - `message:new` → `chat:message`
   - Agregar `driver:on_the_way` y `driver:arrived` si no existen.
3. Probar el flujo completo: crear viaje → oferta → aceptar → tracking → finalizar.

### FASE 6 — Pruebas de Integración (20 horas)

1. Probar 10 flujos completos en paralelo para detectar race conditions.
2. Probar cancelación en cada estado válido.
3. Probar expiración de ofertas.
4. Probar reconexión de socket (caída de internet y recuperación).
5. Probar emergencia (SOS) en cada estado del viaje.
6. Verificar que el chat funciona en tiempo real.

### FASE 7 — Documentación y Deploy (8 horas)

1. Documentar el contrato en `docs/CONTRATO_SOCKET.md`.
2. Actualizar el README con los estados y eventos oficiales.
3. Hacer deploy en staging y correr smoke tests.
4. Pasar a producción.

---

## 4. CHECKLIST DE VERIFICACIÓN

### Backend
- [ ] `VARCHAR(estado)` agrandado a 30 caracteres
- [ ] Migraciones de `expira_at` y `motivo` aplicadas
- [ ] Estados fantasma eliminados de `TripStateMachine`
- [ ] Todos los `emit()` usan constantes del contrato
- [ ] `trip:status_changed` emitido en **toda** transición de estado
- [ ] `chat:message` emitido correctamente
- [ ] Push notifications funcionales en cada evento clave

### Frontend
- [ ] Escucha `trip:status_changed` (no `trip:status`)
- [ ] Escucha `chat:message` (no `message:new`)
- [ ] Escucha `driver:on_the_way` y `driver:arrived`
- [ ] Usa constantes importadas del contrato para estados
- [ ] Maneja reconexión de socket correctamente
- [ ] Muestra correctamente `esperando_confirmacion` (22 caracteres)

### Integración
- [ ] Flujo crear → ofertar → aceptar → en_camino → llegar → en_curso → entregar → esperar_confirmacion → finalizar
- [ ] Cancelación en cada estado permitido
- [ ] SOS en cada estado del viaje
- [ ] Chat en tiempo real
- [ ] 10 flujos concurrentes sin race conditions
