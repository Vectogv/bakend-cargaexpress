# Conexión Backend ↔ Frontend — CargaExpress

**Fecha:** 2026-09-22
**Alcance:** Análisis de estado de conexión entre el backend (AdonisJS) y el frontend real (app Flutter), enfocado en las rutas y el rol **cliente**.

---

## 1. Proyectos identificados (contexto importante)

| Carpeta | Tipo | Relación con este backend |
|---|---|---|
| `bakend-cargaexpress` | Backend AdonisJS 6 (rutas, controladores, sockets, migraciones) | **Es el backend** de CargaExpress |
| `cargaexpressgv` | **App Flutter** (el frontend real) | Cliente App de clientes/conductores/admins |
| `FRONEND_definitivo` | App web React (paneles Administrador/Encargado) | **Es otro proyecto** (reciclaje/recompensas), NO está conectado a este backend |
| `pagina_express` | Web Vite | Página institucional, no API |
| `cargaexpress-autofix` | Script Python | Autofix de pruebas, no UI |

> Conclusión: **el frontend que debe conectarse es la app Flutter `cargaexpressgv`**.

---

## 2. Backend — Mapa completo de rutas `start/routes.ts`

Middlewares usados en grupos:
- `middleware.auth()` → Bearer token (AccessTokens de Adonis)
- `middleware.admin()`, `middleware.moderator()`, `middleware.leader()` → por rol
- `leaderPermission(...)` → permisos granulares
- `rateLimit(...)`, `idempotency()` (requiere header `X-Idempotency-Key`)

### 2.1 Auth — `/api/auth` (rateLimit 10/min por IP)
| Ruta | Controlador | Uso Flutter |
|---|---|---|
| `POST register` | Auth.register | ✅ `auth_service.dart:14` |
| `POST login` | Auth.login | ✅ `auth_service.dart` |
| `POST refresh-token` | Auth.refreshToken | ✅ `auth_service.dart:19` |
| `POST logout` | Auth.logout | ✅ `auth_service.dart:25` |

### 2.2 Users / Perfil — `/api/users` (auth)
| Ruta | Controlador | Uso Flutter |
|---|---|---|
| `GET profile` | Profile.show | ✅ `profile_service.dart:6` |
| `PUT profile` | Profile.update | ✅ `profile_service.dart:10` |
| `POST avatar` | Profile.avatar | ✅ `profile_service.dart:14` (`uploadFile` campo `file`) |
| `PUT fcm-token` | Profile.updateFcmToken | ✅ `notification_service.dart:101` |

### 2.3 Drivers — `/api/drivers` (auth, rol conductor)
| Ruta | Controlador | Uso Flutter |
|---|---|---|
| `PUT status` | Driver.status | ✅ `driver_service.dart:7` |
| `GET earnings` | Driver.earnings | ✅ `:22` |
| `GET stats` | Driver.stats | ✅ `:26` |
| `GET today-stats` | Driver.todayStats | ✅ `:30` |
| `GET earnings/history` | Driver.earningsHistory | ✅ `:38` |
| `GET earnings/pdf` | Driver.earningsPDF | ✅ `:42` (`getBytes`) |
| `POST vehicle-photo` | Driver.vehiclePhoto | ✅ `:61` |
| `PUT location` | Driver.location | ✅ `:14` |
| `POST driver-photo` | Driver.driverPhoto | ✅ `:66` |
| `POST verification/{cedula,licencia,vehiculo}` | Driver.upload* | ✅ `:46,51,56` |

### 2.4 Trips — `/api/trips` (auth) — **núcleo del flujo cliente**
| Ruta | Controlador | Uso Flutter |
|---|---|---|
| `POST request` (idempotent) | Trip.request | ✅ `trip_service.dart:8` |
| `POST reserve` (idempotent) | Trip.reserve | ✅ `:54` |
| `GET nearby?lat&lng&radio` | Trip.nearby | ✅ `:41` |
| `GET active` | Trip.active | ✅ `:13` |
| `GET reservations` | Trip.reservations | ✅ `:61` |
| `GET history` | Trip.history | ✅ `:24` |
| `GET :id` | Trip.show | ✅ `:29` |
| `POST :id/accept` | Trip.accept | ⚠️ **DEPRECADO** (comentario en rutas) — Flutter usa `offers/:offerId/accept` |
| `POST :id/decline` | Trip.decline | ✅ `:66` |
| `POST :id/start-trip` | Trip.startTrip | ✅ `:46` |
| `POST :id/complete` (idempotent) | Trip.complete | ✅ `:81` |
| `POST :id/finalize` (idempotent) | Trip.finalize | ✅ `:88` |
| `POST :id/confirm-close` (idempotent) | Trip.confirmClose | ✅ `:106` |
| `POST :id/cancel` | Trip.cancel | ✅ `:95` |
| `POST :id/request-cancellation` | Trip.requestCancellation | ✅ `:102` |
| `POST :id/rate` | Trip.rate | ✅ `:114` |
| `POST :id/delivery-photo` | Trip.deliveryPhoto | ✅ `:118` |
| `GET :id/chat` / `POST :id/chat` | Chat.index/store | ✅ `chat_service.dart:5,10` |
| `POST :id/dispute` / `:id/dispute/appeal` | Dispute.store/appeal | ✅ `:110,74` |
| `POST :id/dispute/support` | Dispute.uploadSupport | ✅ `:124` |
| `GET :id/nearby-drivers` | Trip.nearbyDrivers | ✅ `:35` |
| `GET :id/offers` / `POST :id/offers` | Offer.index/store | ✅ `offer_service.dart:16,12` |
| `POST :id/offers/:offerId/accept` | Offer.accept | ✅ `offer_service.dart:21` |
| `POST :id/offers/:offerId/reject` | Offer.reject | ✅ `:25` |
| `POST :id/confirm-arrival` | Offer.confirmArrival | ✅ `trip_service.dart:50` |
| `POST :id/confirm-pickup` | Offer.confirmPickup | ✅ `trip_service.dart:70` |
| `POST :id/report` | Report.store | ✅ `report_service.dart:16` |

### 2.5 Notifications — `/api/notifications` (auth)
| Ruta | Controlador | Uso Flutter |
|---|---|---|
| `GET` (paginado) | Notification.index | ✅ `profile_service.dart:22` |
| `PUT :id/read` | Notification.read | ✅ `:27` |
| `DELETE :id` | Notification.destroy | ❌ **No usado** — no hay UI de eliminar notificación |
| `POST` | Notification.store | ❌ No usado (envío interno del servidor) |

### 2.6 Favorites — `/api/favorites` (auth)
| Ruta | Controlador | Uso Flutter |
|---|---|---|
| `GET` / `POST` / `DELETE :id` | FavoriteRoute.* | ✅ `favorite_service.dart:5,18,30` |

### 2.7 Support — `/api/support` (auth)
| Ruta | Controlador | Uso Flutter |
|---|---|---|
| `GET help` | Support.help | ✅ `profile_service.dart:59` |
| `GET emergency` | Support.emergency | ✅ `:63` |

### 2.8 Disputas — `/api/disputes` (auth)
| Ruta | Controlador | Uso Flutter |
|---|---|---|
| `POST` | Dispute.storeRoot | ✅ `dispute_service.dart:10` |
| `GET :id` | Dispute.show | ✅ `:19` |
| `POST :id/version` | Dispute.submitVersion | ✅ `:23` |

### 2.9 Payment — `/api/payment` (auth) + alias
| Ruta | Controlador | Uso Flutter |
|---|---|---|
| `GET debt` | Payment.info | ✅ `payment_service.dart:5` y `driver_service.dart:34` (deuda conductor) |
| `POST proof` | Payment.uploadProof | ✅ `payment_service.dart:16` |
| `GET /api/payments` (alias Flutter) | Payment.info | ✅ `payment_service.dart:9` |

### 2.10 Settings — `/api/settings` (auth)
| Ruta | Controlador | Uso Flutter |
|---|---|---|
| `GET` / `PUT` | Settings.show/update | ✅ `profile_service.dart:51,55` |

### 2.11 Config / públicos
| Ruta | Controlador | Uso Flutter |
|---|---|---|
| `GET /api/config/banner` (sin auth) | inline (serialize.withoutWrapping) | ⚠️ Poco usado |
| `GET /api/config/mapbox` (auth) | Mapbox.token | ✅ `profile_service.dart:67` |

### 2.12 Avisos — `/api/avisos` (auth, usa ModeratorController)
| Ruta | Controlador | Uso Flutter |
|---|---|---|
| `GET` / `POST` | Moderator.avisosIndex/Store | ✅ `profile_service.dart:32,37` |
| `PUT :id/pin` / `DELETE :id` | Moderator.avisosPin/Delete | ❌ No usado (solo admin/moderador) |

### 2.13 Emergency
| Ruta | Controlador | Uso Flutter |
|---|---|---|
| `POST /api/emergency` (auth) | Emergency.trigger | ✅ `sos_service.dart:26` |
| `GET /api/emergency/:id/messages` + `POST` | EmergencyChat | ✅ `sos_service.dart:35,40` |
| `GET /api/sos` (solo admin) | Admin.sosAlerts | ✅ `sos_monitor_screen.dart:24` |

### 2.14 Fraud
| Ruta | Controlador | Uso Flutter |
|---|---|---|
| `POST /api/fraud/alerts` | FraudAlert.store | ✅ `fraud_detection_service.dart:173` |

### 2.15 Conversaciones — `/api/conversations` (auth) y `/api/moderator/conversations`
| Ruta | Controlador | Uso Flutter |
|---|---|---|
| `GET unread-count` | Conversacion.unreadCount | ✅ `chat_service.dart:29` |
| `GET` / `GET :id/messages` / `POST :id/messages` | Conversacion.* | ✅ `chat_service.dart:14,19,24` |

### 2.16 Admin — `/api/admin` (auth + admin)
Panel admin casi completo en Flutter (`lib/screens/admin/*`). Rutas que el frontend **no usa** todavía:
- `GET users` ✅ / `PUT users/:id` ⚠️ (solo GET + delete + suspend en UI) 
- `GET drivers` ✅ / `PUT drivers/:conductorId/city` ❌
- `GET commissions` ✅ / `PUT commissions/:id/paid` ✅ / `GET commissions/:id/history` ✅
- `GET verifications` ✅ / approve/reject ✅
- `PUT users/:id/clear-debt` ✅ / `moderator` ✅ / `leader` ✅ / `role` ⚠️
- `GET comunicados` ✅ / `approve` ✅ / `reject` ✅
- `GET encuestas` ✅ / `approve` ✅ (pero el resto de módulo encuestas es "pendiente")
- `GET moderator-reports` ✅ (con fallback mock)
- `GET backups` ✅ / `POST backups/run` ✅ (con fallback mock)
- `GET cancellation-requests` ✅ / approve/reject ✅
- `GET profile` ✅ / `PUT profile` ✅ / `POST profile/avatar` ✅
- `PUT config` ✅ / `config/coverage` ✅ / `config/banner` ✅
- `GET reports` ✅ / `PUT reports/:id/resolve` ✅
- `GET disputes` ✅ / `PUT disputes/:id/resolve` ✅
- `GET emergencys` ✅ / `PUT emergencys/:id/resolve` ✅
- `PUT users/:id/suspend` ✅ / `avatar` ✅ / `deleteUser` ✅

### 2.17 Moderador — `/api/moderator` (auth + moderator)
**Sin pantallas en el frontend** (no existe `lib/screens/moderador`). Uso actual en Flutter:
- `GET /api/moderator/encuestas/:id/results` — `profile_service.dart:41`
- `POST /api/moderator/encuestas/:id/answer` — `profile_service.dart:47`
- Resto de rutas (comunicados, drivers, trips, emergency, contactable-users, conversations) → **sin uso**.

### 2.18 Líder — `/api/leader` (auth + leader + permisos)
**Sin ningún uso en Flutter.** No hay UI de líder ni llamadas a `/api/leader/*` en `lib/`.

---

## 3. Sockets — canal en tiempo real (`start/socket.ts`)

**Autenticación:** `token` por query string (`socket.handshake.query.token`), verificado con `User.accessTokens.verify()`. Rooms por rol:
- `client:{id}`, `driver:{id}`, `admin`, `moderator:{zona}`, `leader`
- `trip:{id}` → requiere `join:trip` y validación de participación

**Handlers (client → server):**
| Evento | Servidor |
|---|---|
| `join:trip` / `leave:trip` | une/abandona room `trip:{id}` |
| `typing:start` / `typing:stop` | reenvía al otro participante del viaje |
| `message:read` | marca leído + reenvía |
| `message:send` | solo valida participación (la persistencia es REST) |
| `driver:location` | solo conductor → emite `driver:location` al cliente |
| `trip:finalize_request` | → emite a cliente |
| `trip:finalize_response` | → emite a conductor |
| `trip:finalize_cancelled` | → emite a cliente |
| `join:driver` / `join:client` | no-op (rooms armados por rol) |

**Eventos emitidos al cliente (más relevantes rol cliente):**
`trip:status` + `trip:status_changed` (toda la vida del viaje), `driver:location`, `trip:finalize_request`, `trip:finalize_response` (si es conductor target), `trip:finalize_cancelled`, `driver:location`, más los emitidos por controladores vía `emitToClient/emitToTrip/emitToUser` (ofertas: `new:offer`/`trip:offer_received`, etc.).

**Lado Flutter** (`socket_service_client.dart`): suscribe `onTripStatus`, `onDriverLocation`, `onNewOffer`, `onTripOfferReceived`, `onOfferAccepted`, `onTripAccepted`, `onTripStarted`, `onTripDelivered`, `onTripCompleted`, `onTripCancelled`, `onFinalizeRequest/Response/Cancelled`, `onCloseRejected`, `onMessage`, `onTypingStart/Stop`, `onMessageRead`, `onConversationMessage`, `onEmergencyMessage`, streams admin, etc.

**⚠️ Alerta de nombres:** el servidor usa **`trip:status`** (y alias `trip:status_changed`). El cliente Flutter escucha `onTripStatus`. Verificar que el nombre registrado en `socket.ts`/controladores coincida con `contracts/socket_events.dart` en Flutter.

---

## 4. Frontend Flutter — Capa de red (`lib/services/`)

**Base URL** (`core/environment.dart`):
```
default (producción): https://bakend-cargaexpress-production.up.railway.app
--dart-define=PRODUCTION_URL=...  → override
--dart-define=TEST_MODE=true     → http://10.0.2.2:3333 (emulador Android)
wsUrl = baseUrl (mismos servidor/dominio)
```

**HttpClient** (`services/api/http_client.dart`): `get`, `getList`, `post`, `put`, `delete`, `uploadFile`, `getBytes`.
- 401 + auth → refresh token (futuro compartido, evita refresh en cascada) → reintenta 1 vez.
- Timeout 20s en todas las peticiones.
- Header `X-Idempotency-Key` en `request`, `reserve`, `complete`, `finalize` (idempotencia).
- Errores de red traducidos a `ApiException` legibles.

**ApiClient** (`services/api_client.dart` + `auth_response.dart`): maneja token/refresh/sesión expirada. `notification_service.dart` también usa `ApiClient.baseUrl`.

**Servicios por recurso** (`services/api/`): `auth_service, chat_service, dispute_service, driver_service, favorite_service, http_client, offer_service, payment_service, profile_service, trip_service`. Todos mapean 1:1 con los endpoints del backend (§2).

**Otros servicios usados:** `sos_service`, `report_service`, `fraud_detection_service`, `notification_service`, `socket_service_client`, `route_service`.

---

## 5. Pantallas de cliente (`lib/screens/cliente/`) y su conexión

| Pantalla | Consume API | Notas |
|---|---|---|
| `home_screen.dart` | ✅ ApiClient/Cache/Notification | Inicio por rol cliente |
| `nuevo_envio_screen.dart` | ✅ `HttpClient` + Mapbox + GPS | Crea viaje |
| `ofertas_recibidas_screen.dart` | ✅ `OfferService` + sockets | Lista/acepta/rechaza ofertas |
| `oferta_aceptada_screen.dart` | ✅ vía rastreo/offer | |
| `rastreo_screen.dart` | ✅ `TripService`, `OfferService`, `SosService`, sockets | Pantalla central del viaje activo |
| `llegada_al_destino_screen.dart` | ⚠️ Parcial | Foto de entrega con **fallback mock** (`_buildMockPhoto`, `:295`) |
| `confirmar_entrega_screen.dart` | ✅ confirm-close | |
| `mis_envios_screen.dart` | ✅ `ApiClient`/Trips | Historial |
| `viaje_detalle_screen.dart` | ✅ `ApiClient` | Detalle |
| `viaje_finalizado.dart` | ✅ | Cierre + calificación |
| `calificar_conductor_screen.dart` | ✅ rate | |
| `cancel_trip_screen.dart` | ✅ cancel/request-cancellation | |
| `reportar_problema_screen.dart` | ✅ report/disputa | |
| `resolucion_screen.dart` / `detalle_resolucion_screen.dart` | ✅ disputas | |
| `disputa_creada_screen.dart` / `disputa_en_revision_screen.dart` | ✅ disputa | |
| `chat_screen.dart` / `chat_thread_screen.dart` | ✅ ChatService + sockets | Chat del viaje + conversación soporte |
| `pagos_screen.dart` | ✅ `PaymentService` | Deuda + comprobante |
| `perfil_screen.dart` | ✅ `ApiClient`/Profile | |
| `ajustes_screen.dart` | ⚠️ Revisar | Config local |
| `soporte_screen.dart` | ✅ `ChatService` + sockets | Soporte por conversaciones |
| `emergencia_chat_screen.dart` | ✅ `SosService` + sockets | |

---

## 6. Hallazgos — Gaps y problemas de conexión

### 🔴 Críticos
1. **`/api/moderator/encuestas/*` llamadas con rol no moderador.** `profile_service.dart:41,47` llama `GET/POST /api/moderator/encuestas/...` con **solo `auth`**. Si lo invocan clientes/conductores → **403 Forbidden** (requiere `middleware.moderator()`). Al mismo tiempo la pantalla de encuestas del conductor (`surveys_screen.dart`) está **vacía/decorativa** ("Las encuestas son gestionadas por moderadores"). **Solución:** backend debe exponer rutas de encuestas accesibles a conductor/cliente con `auth` (no moderator) o el frontend debe dejar de usarlas.

2. **`NewAccountController` sin ruta registrada.** Existe `app/controllers/new_account_controller.ts` pero **NO aparece en `start/routes.ts`** → el endpoint de creación de cuenta/aliado no existe. Definir rutas o eliminar el controlador.

3. **Paneles admin con datos mock como fallback.** Estas pantallas caen a `_mock*` cuando falla la API (usan `List.from(_mock…)` en el `catch`): `gestion_backups`, `gestion_comunicados`, `gestion_emergencias`, `gestion_disputas`, `gestion_encuestas`, `reportes_moderadores`, `soporte_reportes`. **Riesgo grave:** si el backend falla, la UI muestra datos **falsos** como si fueran reales (el usuario no sabe que son mock). Recomendado: reemplazar fallback mock por estado vacío + error visible.

### 🟠 Importante
4. **Roles sin UI ni consumo:** `/api/leader/*` (sin pantallas ni llamadas) y `/api/moderator/*` (sin pantallas, solo 2 llamadas encuestas). Decide si se construyen las pantallas o se eliminan del frontend.
5. **`DELETE /api/notifications/:id`** existe en backend y **no se usa** en Flutter.
6. **Discrepancia potencial de nombres de eventos socket** entre `trip:status` (servidor) y lo suscrito en `SocketServiceClient` (`contracts/socket_events.dart`). Verificar.
7. **`report_service.dart:22`** hace `GET /api/admin/reports` (ruta **solo admin**). Confirmar que solo se invoca desde pantallas admin; si se llama desde perfil cliente → 403.

### 🟡 Menores / a considerar
8. **Fotos de entrega con mock**: `llegada_al_destino_screen.dart` usa `_buildMockPhoto()` si la foto no carga. Decidir si es aceptable.
9. **Deprecación de `POST /api/trips/:id/accept`**: el frontend ya usa `offers/:offerId/accept`; considerar eliminar del backend o mantener para compatibilidad.
10. **`GET /api/config/banner`** (público) no se consume apenas; hay `PUT /api/admin/config/banner` sí usado en admin.
11. **Idempotencia:** las 5 llamadas que exigen `X-Idempotency-Key` ya envían la clave generada — bien.
12. **Serialización:** backend responde vía `serialize` (con `data` envuelto); `trip_service.dart:40` ya "tolera ambos contratos" (array plano vs `{data:[]}`). Mantener tolerancia o estandarizar.

---

## 7. Recomendación de plan de conexión (siguientes pasos)

1. **Abrir las encuestas al rol correcto**: agregar rutas públicas/auth para `encuestas` y `answer/results` (o quitar su uso del perfil).
2. **Registrar rutas de `NewAccountController`** o depurarlo.
3. **Eliminar los fallbacks mock** de las 7 pantallas admin (mostrar vacío + error).
4. **Auditar `contracts/socket_events.dart`** vs nombres reales emitidos por el backend (controladores + socket.ts).
5. **Decidir UI de roles Líder y Moderador** (o documentar soporte futuro).
6. **Conectar/usar `DELETE /api/notifications/:id`** en la UI de notificaciones si aplica.
7. **Correr análisis estático**: `flutter analyze` en `cargaexpressgv` y lint/tests en `bakend-cargaexpress`.

---

## 8. Archivos clave referenciados

**Backend:** `start/routes.ts`, `start/socket.ts`, `config/cors.ts`, `app/controllers/*`
**Frontend:** `lib/core/environment.dart`, `lib/services/api/http_client.dart`, `lib/services/api/*.dart`, `lib/services/socket_service_client.dart`, `lib/screens/{cliente,conductor,admin,user}/*`, `lib/main.dart`