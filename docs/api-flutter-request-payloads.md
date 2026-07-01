# API CargaExpress — Payloads que el Backend Recibe desde Flutter

> **Propósito:** Documentar todos los JSON, parámetros de ruta, query params, archivos subidos, autenticación y permisos que el backend espera recibir desde la app Flutter.

---

## Convenciones

- **Auth**: `Bearer token` en header `Authorization`.
- **Content-Type**: `application/json` (excepto donde se indique `multipart/form-data`).
- **Rol requerido**: Se especifica por endpoint.
- **Campos opcionales**: Marcados con `?`.
- **Tipos**: `string`, `number`, `boolean`, `object`, `array`, `null`.
- **Middleware adicional**: `rateLimit`, `idempotency`, `admin`, `moderator`, `leader`, `leaderPermission`.

---

## Índice

1. [Auth — `/api/auth`](#1-auth--apiauth)
2. [Perfil de Usuario — `/api/users`](#2-perfil-de-usuario--apiusers)
3. [Conductor — `/api/drivers`](#3-conductor--apidrivers)
4. [Viajes — `/api/trips`](#4-viajes--apitrips)
5. [Ofertas — `/api/trips/:id/offers`](#5-ofertas--apitripsidoffers)
6. [Chat — `/api/trips/:id/chat`](#6-chat--apitripidchat)
7. [Disputas — `/api/disputes` y `/api/trips/:id/dispute`](#7-disputas--apidisputes-y-apitripidispute)
8. [Reportes de Conductor — `/api/trips/:id/report`](#8-reportes-de-conductor--apitripidreport)
9. [Notificaciones — `/api/notifications`](#9-notificaciones--apinotifications)
10. [Rutas Favoritas — `/api/favorites`](#10-rutas-favoritas--apifavorites)
11. [Soporte — `/api/support`](#11-soporte--apisupport)
12. [Pagos — `/api/payment`](#12-pagos--apipayment)
13. [Configuración de Usuario — `/api/settings`](#13-configuracin-de-usuario--apisettings)
14. [Configuración Pública — `/api/config`](#14-configuracin-pblica--apiconfig)
15. [Emergencia — `/api/emergency`](#15-emergencia--apiemergency)
16. [Moderador — `/api/moderator`](#16-moderador--apimoderator)
17. [Avisos — `/api/avisos`](#17-avisos--apiavisos)
18. [Admin — `/api/admin`](#18-admin--apiadmin)
19. [Líder — `/api/leader`](#19-lder--apileader)

---

## 1. Auth — `/api/auth`

### `POST /api/auth/register`
**Auth:** ❌ Público (rateLimit: 10/min/IP)

| Campo | Tipo | Requerido | Descripción |
|-------|------|-----------|-------------|
| `nombre` | `string` (max 100) | ✅ | |
| `apellido` | `string` (max 100) | ✅ | |
| `email` | `string` (email, max 254) | ✅ | Único en DB |
| `password` | `string` (6-32 chars) | ✅ | |
| `telefono` | `string` (max 20) | ❌ nullable | |
| `rol` | `enum("conductor","cliente","admin")` | ✅ | |
| `edad` | `number` (18-120) | ❌ nullable | |
| `cedula` | `string` (max 20) | ❌ nullable | Requerido si `rol=conductor` |
| `placa` | `string` (max 20) | ❌ nullable | Requerido si `rol=conductor` |
| `tipoVehiculo` | `string` (max 50) | ❌ nullable | Requerido si `rol=conductor` |
| `capacidad` | `string` (max 50) | ❌ nullable | Requerido si `rol=conductor` |

```json
{
  "nombre": "Juan",
  "apellido": "Pérez",
  "email": "juan@email.com",
  "password": "123456",
  "telefono": "3001234567",
  "rol": "conductor",
  "edad": 30,
  "cedula": "1234567890",
  "placa": "ABC123",
  "tipoVehiculo": "Sedán",
  "capacidad": "4 pasajeros"
}
```

---

### `POST /api/auth/login`
**Auth:** ❌ Público (rateLimit: 10/min/IP)

| Campo | Tipo | Requerido |
|-------|------|-----------|
| `email` | `string` (email) | ✅ |
| `password` | `string` | ✅ |

```json
{
  "email": "juan@email.com",
  "password": "123456"
}
```

---

### `POST /api/auth/refresh-token`
**Auth:** ❌ Público (rateLimit: 10/min/IP)

| Campo | Tipo | Requerido |
|-------|------|-----------|
| `refreshToken` | `string` | ✅ |

```json
{
  "refreshToken": "uuid-del-refresh-token"
}
```

---

### `POST /api/auth/logout`
**Auth:** ✅ Bearer token (opcional — graceful si expiró)
**Body:** Ninguno

---

## 2. Perfil de Usuario — `/api/users`

### `GET /api/users/profile`
**Auth:** ✅ Bearer token (cualquier rol)
**Body:** Ninguno

---

### `PUT /api/users/profile`
**Auth:** ✅ Bearer token (cualquier rol)

| Campo | Tipo | Requerido |
|-------|------|-----------|
| `nombre` | `string` (max 100) | ❌ |
| `apellido` | `string` (max 100) | ❌ |
| `email` | `string` (email, max 254) | ❌ |
| `telefono` | `string` (max 20) | ❌ nullable |
| `edad` | `number` (18-120) | ❌ nullable |
| `contactoEmergenciaNombre` | `string` (max 100) | ❌ nullable |
| `contactoEmergenciaTelefono` | `string` (max 20) | ❌ nullable |

```json
{
  "nombre": "Juan",
  "apellido": "Pérez",
  "email": "juan@email.com",
  "telefono": "3001234567",
  "edad": 31,
  "contactoEmergenciaNombre": "María",
  "contactoEmergenciaTelefono": "3007654321"
}
```

---

### `POST /api/users/avatar`
**Auth:** ✅ Bearer token (cualquier rol)
**Tipo:** `multipart/form-data`

| Campo | Tipo | Requerido | Descripción |
|-------|------|-----------|-------------|
| `file` | `file` | ✅ | Imagen (jpg/jpeg/png/gif/webp, máx 5MB) |

---

### `PUT /api/users/fcm-token`
**Auth:** ✅ Bearer token (cualquier rol)

| Campo | Tipo | Requerido |
|-------|------|-----------|
| `fcmToken` | `string` o `null` | ❌ |

```json
{
  "fcmToken": "firebase-cloud-messaging-token"
}
```

---

## 3. Conductor — `/api/drivers`

### `PUT /api/drivers/status`
**Auth:** ✅ Bearer token (`rol=conductor`)

| Campo | Tipo | Requerido |
|-------|------|-----------|
| `online` | `boolean` | ✅ |

```json
{
  "online": true
}
```

---

### `PUT /api/drivers/location`
**Auth:** ✅ Bearer token (`rol=conductor`)
**Nota:** Rate-limited por GPS (Redis).

| Campo | Tipo | Requerido |
|-------|------|-----------|
| `lat` | `number` (-90 a 90) | ✅ |
| `lng` | `number` (-180 a 180) | ✅ |

```json
{
  "lat": 3.4516,
  "lng": -76.532
}
```

---

### `GET /api/drivers/earnings`
**Auth:** ✅ Bearer token (`rol=conductor`)
**Body:** Ninguno

### `GET /api/drivers/earnings/history`
**Auth:** ✅ Bearer token (`rol=conductor`)
**Query Params:**

| Parámetro | Tipo | Default | Valores |
|-----------|------|---------|---------|
| `periodo` | `string` | `"todo"` | `"todo"`, `"semana"`, `"mes"` |
| `page` | `number` | `1` | |
| `limit` | `number` | `20` | |

### `GET /api/drivers/earnings/pdf`
**Auth:** ✅ Bearer token (`rol=conductor`)
**Query Params:**

| Parámetro | Tipo | Default | Valores |
|-----------|------|---------|---------|
| `periodo` | `string` | `"todo"` | `"todo"`, `"semana"`, `"mes"` |

### `GET /api/drivers/stats`
**Auth:** ✅ Bearer token (`rol=conductor`)

### `GET /api/drivers/today-stats`
**Auth:** ✅ Bearer token (`rol=conductor`)

---

### `POST /api/drivers/vehicle-photo`
**Auth:** ✅ Bearer token (`rol=conductor`)
**Tipo:** `multipart/form-data`

| Campo | Tipo | Requerido | Descripción |
|-------|------|-----------|-------------|
| `file` | `file` | ✅ | Imagen (jpg/jpeg/png/gif/webp, máx 5MB) |

### `POST /api/drivers/driver-photo`
**Auth:** ✅ Bearer token (`rol=conductor`)
**Tipo:** `multipart/form-data`

| Campo | Tipo | Requerido | Descripción |
|-------|------|-----------|-------------|
| `file` | `file` | ✅ | Imagen (jpg/jpeg/png/gif/webp, máx 5MB) |

### `POST /api/drivers/verification/cedula`
**Auth:** ✅ Bearer token (`rol=conductor`)
**Tipo:** `multipart/form-data`

| Campo | Tipo | Requerido | Descripción |
|-------|------|-----------|-------------|
| `file` | `file` | ✅ | Imagen (jpg/jpeg/png/gif/webp, máx 5MB) |

### `POST /api/drivers/verification/licencia`
**Auth:** ✅ Bearer token (`rol=conductor`)
**Tipo:** `multipart/form-data`

| Campo | Tipo | Requerido | Descripción |
|-------|------|-----------|-------------|
| `file` | `file` | ✅ | Imagen (jpg/jpeg/png/gif/webp, máx 5MB) |

### `POST /api/drivers/verification/vehiculo`
**Auth:** ✅ Bearer token (`rol=conductor`)
**Tipo:** `multipart/form-data`

| Campo | Tipo | Requerido | Descripción |
|-------|------|-----------|-------------|
| `file` | `file` | ✅ | Imagen (jpg/jpeg/png/gif/webp, máx 5MB) |

---

## 4. Viajes — `/api/trips`

### `POST /api/trips/request`
**Auth:** ✅ Bearer token (`rol=cliente`)
**Middleware:** `rateLimit(5/min)`, `idempotency`

| Campo | Tipo | Requerido | Descripción |
|-------|------|-----------|-------------|
| `origen.direccion` | `string` | ✅ | Dirección texto |
| `origen.lat` | `number` (-90 a 90) | ✅ | Latitud |
| `origen.lng` | `number` (-180 a 180) | ✅ | Longitud |
| `destino.direccion` | `string` | ✅ | Dirección texto |
| `destino.lat` | `number` (-90 a 90) | ✅ | Latitud |
| `destino.lng` | `number` (-180 a 180) | ✅ | Longitud |
| `descripcion` | `string` | ❌ nullable | Descripción de la carga |
| `precioCliente` | `number` (min 0) | ✅ | Precio que ofrece el cliente |

```json
{
  "origen": {
    "direccion": "Calle 1 #2-3, Cali",
    "lat": 3.4516,
    "lng": -76.532
  },
  "destino": {
    "direccion": "Carrera 4 #5-6, Cali",
    "lat": 3.4616,
    "lng": -76.542
  },
  "descripcion": "Caja de 10kg",
  "precioCliente": 25000
}
```

---

### `GET /api/trips/nearby`
**Auth:** ✅ Bearer token (cualquier rol)
**Query Params:**

| Parámetro | Tipo | Default | Descripción |
|-----------|------|---------|-------------|
| `lat` | `number` | Última ubicación del conductor | Latitud del centro de búsqueda |
| `lng` | `number` | Última ubicación del conductor | Longitud del centro de búsqueda |
| `radio` | `number` | `20` | Radio en km (0-200) |

### `GET /api/trips/history`
**Auth:** ✅ Bearer token (cualquier rol)
**Query Params:**

| Parámetro | Tipo | Default |
|-----------|------|---------|
| `page` | `number` | `1` |
| `limit` | `number` | `20` (max 100) |

### `GET /api/trips/active`
**Auth:** ✅ Bearer token (cualquier rol)

### `GET /api/trips/:id`
**Auth:** ✅ Bearer token (cliente dueño, conductor asignado, o admin)
**URL Params:** `id` — ID del viaje

---

### `POST /api/trips/:id/accept` ⚠️ Deprecado
**Auth:** ✅ Bearer token (`rol=conductor`)
**Nota:** Usar `POST /api/trips/:id/offers/:offerId/accept` en su lugar.

### `POST /api/trips/:id/decline`
**Auth:** ✅ Bearer token (`rol=conductor`)

### `POST /api/trips/:id/start-trip`
**Auth:** ✅ Bearer token (`rol=conductor`, asignado al viaje)

### `POST /api/trips/:id/complete`
**Auth:** ✅ Bearer token (`rol=conductor`, asignado al viaje)
**Middleware:** `rateLimit(5/min)`, `idempotency`

| Campo | Tipo | Requerido |
|-------|------|-----------|
| `montoFinal` | `number` (min 0) | ✅ |

```json
{
  "montoFinal": 25000
}
```

### `POST /api/trips/:id/finalize`
**Auth:** ✅ Bearer token (`rol=cliente`, `conductor`, o `admin`)
**Middleware:** `rateLimit(5/min)`, `idempotency`

| Campo | Tipo | Requerido |
|-------|------|-----------|
| `montoFinal` | `number` (min 0) | ✅ |

```json
{
  "montoFinal": 25000
}
```

---

### `POST /api/trips/:id/cancel`
**Auth:** ✅ Bearer token (cliente dueño, conductor asignado, o admin)

| Campo | Tipo | Requerido |
|-------|------|-----------|
| `motivo` | `string` | ❌ nullable |

```json
{
  "motivo": "Ya no necesito el servicio"
}
```

---

### `POST /api/trips/:id/request-cancellation`
**Auth:** ✅ Bearer token (`rol=conductor` o `cliente` - solo si viaje en `en_curso`)

| Campo | Tipo | Requerido |
|-------|------|-----------|
| `motivo` | `string` | ❌ (default: `"Sin motivo especificado"`) |

```json
{
  "motivo": "El cliente no responde"
}
```

---

### `POST /api/trips/:id/rate`
**Auth:** ✅ Bearer token (`rol=cliente` o `conductor` del viaje - solo si `finalizado`)

| Campo | Tipo | Requerido |
|-------|------|-----------|
| `puntaje` | `number` (1-5) | ✅ |
| `comentario` | `string` | ❌ nullable |

```json
{
  "puntaje": 5,
  "comentario": "Excelente servicio"
}
```

---

### `POST /api/trips/:id/delivery-photo`
**Auth:** ✅ Bearer token (`rol=conductor`, asignado - solo si `en_curso` o `completado`)
**Tipo:** `multipart/form-data`

| Campo | Tipo | Requerido | Descripción |
|-------|------|-----------|-------------|
| `file` | `file` | ✅ | Imagen (jpg/jpeg/png/gif/webp, máx 5MB) |

---

## 5. Ofertas — `/api/trips/:id/offers`

### `GET /api/trips/:id/offers`
**Auth:** ✅ Bearer token (cliente dueño del viaje)

### `POST /api/trips/:id/offers`
**Auth:** ✅ Bearer token (`rol=conductor`)
**Middleware:** `rateLimit(10/min)`

| Campo | Tipo | Requerido |
|-------|------|-----------|
| `monto` | `number` (min 0) | ✅ |

```json
{
  "monto": 22000
}
```

### `POST /api/trips/:id/offers/:offerId/accept`
**Auth:** ✅ Bearer token (cliente dueño del viaje)
**URL Params:** `id` (viaje ID), `offerId` (oferta ID)

### `POST /api/trips/:id/offers/:offerId/reject`
**Auth:** ✅ Bearer token (cliente dueño del viaje)
**URL Params:** `id` (viaje ID), `offerId` (oferta ID)

---

## 6. Chat — `/api/trips/:id/chat`

### `GET /api/trips/:id/chat`
**Auth:** ✅ Bearer token (participante del viaje - solo si `aceptado` o `en_curso`)

### `POST /api/trips/:id/chat`
**Auth:** ✅ Bearer token (participante del viaje - solo si `aceptado` o `en_curso`)

| Campo | Tipo | Requerido |
|-------|------|-----------|
| `mensaje` | `string` (no vacío) | ✅ |

```json
{
  "mensaje": "Ya llegué al punto de recogida"
}
```

---

## 7. Disputas — `/api/disputes` y `/api/trips/:id/dispute`

### `POST /api/trips/:id/dispute`
**Auth:** ✅ Bearer token (`rol=conductor` o `cliente` - solo si viaje `finalizado`)

| Campo | Tipo | Requerido |
|-------|------|-----------|
| `version` | `string` | ❌ (al menos 1 requerido) |
| `motivo` | `string` | ❌ (al menos 1 requerido) |
| `descripcion` | `string` | ❌ (al menos 1 requerido) |

```json
{
  "version": "Acordamos 25000 pero pagó 20000",
  "motivo": "Pago incompleto",
  "descripcion": "El cliente no pagó el monto acordado"
}
```

### `POST /api/trips/:id/dispute/appeal`
**Auth:** ✅ Bearer token (cliente de la disputa - solo si `abierta`)

| Campo | Tipo | Requerido |
|-------|------|-----------|
| `version` | `string` | ❌ (al menos 1 requerido) |
| `motivo` | `string` | ❌ (al menos 1 requerido) |
| `descripcion` | `string` | ❌ (al menos 1 requerido) |

### `POST /api/trips/:id/dispute/support`
**Auth:** ✅ Bearer token (cliente de la disputa)
**Tipo:** `multipart/form-data`

| Campo | Tipo | Requerido | Descripción |
|-------|------|-----------|-------------|
| `file` | `file` | ✅ | Imagen o PDF (jpg/jpeg/png/gif/webp/pdf, máx 5MB) |

---

### `POST /api/disputes` (raíz)
**Auth:** ✅ Bearer token (`rol=conductor` o `cliente`)

| Campo | Tipo | Requerido |
|-------|------|-----------|
| `tripId` | `number` | ✅ |
| `problema` | `string` | ❌ |
| `descripcion` | `string` | ❌ |
| `fotos` | `array[string]` | ❌ (default `[]`) |

```json
{
  "tripId": 123,
  "problema": "Pago incompleto",
  "descripcion": "Descripción detallada",
  "fotos": ["url1.jpg", "url2.jpg"]
}
```

### `GET /api/disputes/:id`
**Auth:** ✅ Bearer token (cliente o conductor de la disputa)

### `POST /api/disputes/:id/version`
**Auth:** ✅ Bearer token (cliente o conductor de la disputa)

| Campo | Tipo | Requerido |
|-------|------|-----------|
| `version` | `string` (no vacío) | ✅ |

```json
{
  "version": "Mi versión de los hechos es..."
}
```

---

## 8. Reportes de Conductor — `/api/trips/:id/report`

### `POST /api/trips/:id/report`
**Auth:** ✅ Bearer token (`rol=conductor`, asignado al viaje)

| Campo | Tipo | Requerido | Valores |
|-------|------|-----------|---------|
| `motivo` | `string` | ✅ | `"no_pago"`, `"comportamiento"`, `"otro"` |
| `descripcion` | `string` | ❌ | |

```json
{
  "motivo": "no_pago",
  "descripcion": "El cliente no pagó el monto acordado"
}
```

---

## 9. Notificaciones — `/api/notifications`

### `GET /api/notifications`
**Auth:** ✅ Bearer token (cualquier rol)
**Query Params:**

| Parámetro | Tipo | Default |
|-----------|------|---------|
| `page` | `number` | `1` |
| `limit` | `number` | `20` |

### `PUT /api/notifications/:id/read`
**Auth:** ✅ Bearer token (cualquier rol)

---

## 10. Rutas Favoritas — `/api/favorites`

### `GET /api/favorites`
**Auth:** ✅ Bearer token (cualquier rol)

### `POST /api/favorites`
**Auth:** ✅ Bearer token (cualquier rol)

| Campo | Tipo | Requerido |
|-------|------|-----------|
| `nombre` | `string` | ✅ |
| `origenDireccion` | `string` | ✅ |
| `origenLat` | `number` | ✅ |
| `origenLng` | `number` | ✅ |
| `destinoDireccion` | `string` | ✅ |
| `destinoLat` | `number` | ✅ |
| `destinoLng` | `number` | ✅ |

```json
{
  "nombre": "Casa -> Trabajo",
  "origenDireccion": "Calle 1 #2-3, Cali",
  "origenLat": 3.4516,
  "origenLng": -76.532,
  "destinoDireccion": "Cra 4 #5-6, Cali",
  "destinoLat": 3.4616,
  "destinoLng": -76.542
}
```

### `DELETE /api/favorites/:id`
**Auth:** ✅ Bearer token (dueño de la ruta)

---

## 11. Soporte — `/api/support`

### `GET /api/support/help`
**Auth:** ✅ Bearer token (cualquier rol)

### `GET /api/support/emergency`
**Auth:** ✅ Bearer token (cualquier rol)

---

## 12. Pagos — `/api/payment`

### `GET /api/payment/debt` (también `GET /api/payments`)
**Auth:** ✅ Bearer token (cualquier rol)

### `POST /api/payment/proof`
**Auth:** ✅ Bearer token (cualquier rol, debe tener `estadoCuenta === "suspension_por_pago"`)
**Tipo:** `multipart/form-data`

| Campo | Tipo | Requerido | Descripción |
|-------|------|-----------|-------------|
| `file` | `file` | ✅ | Imagen o PDF (jpg/jpeg/png/gif/webp/pdf, máx 5MB) |

---

## 13. Configuración de Usuario — `/api/settings`

### `GET /api/settings`
**Auth:** ✅ Bearer token (cualquier rol)

### `PUT /api/settings`
**Auth:** ✅ Bearer token (cualquier rol)

| Campo | Tipo | Requerido | Valores |
|-------|------|-----------|---------|
| `idioma` | `string` | ❌ | `"es"`, `"en"` |
| `notificacionesSonido` | `boolean` | ❌ | |
| `visibilidad` | `string` | ❌ | `"visible"`, `"oculto"`, `"solo_conductores"` |

```json
{
  "idioma": "es",
  "notificacionesSonido": true,
  "visibilidad": "visible"
}
```

---

## 14. Configuración Pública — `/api/config`

### `GET /api/config/banner`
**Auth:** ❌ Público

### `GET /api/config/mapbox`
**Auth:** ✅ Bearer token (cualquier rol)

---

## 15. Emergencia — `/api/emergency`

### `POST /api/emergency`
**Auth:** ✅ Bearer token (cualquier rol)

| Campo | Tipo | Requerido |
|-------|------|-----------|
| `viajeId` | `number` | ❌ |
| `lat` | `number` | ❌ |
| `lng` | `number` | ❌ |

```json
{
  "viajeId": 123,
  "lat": 3.4516,
  "lng": -76.532
}
```

---

## 16. Moderador — `/api/moderator`

**Middleware base:** `auth()`, `moderator()` (requiere `user.esModerador === true`)

### `POST /api/moderator/comunicados`
| Campo | Tipo | Requerido |
|-------|------|-----------|
| `titulo` | `string` | ✅ |
| `contenido` | `string` | ✅ |

```json
{
  "titulo": "Aviso importante",
  "contenido": "Recordatorio para todos los conductores..."
}
```

### `GET /api/moderator/comunicados`
**Query Params:** `page` (default 1), `limit` (default 20)

### `GET /api/moderator/drivers`
**Query Params:** `page` (default 1), `limit` (default 20)

### `GET /api/moderator/drivers/inactive`
**Query Params:** `page` (default 1), `limit` (default 20)

### `POST /api/moderator/drivers/:id/notify`
**Auth:** Moderador
**Body:** Ninguno

### `POST /api/moderator/drivers/:id/report`
| Campo | Tipo | Requerido |
|-------|------|-----------|
| `descripcion` | `string` | ✅ |

```json
{
  "descripcion": "El conductor no ha estado activo en 2 semanas"
}
```

### `POST /api/moderator/encuestas`
| Campo | Tipo | Requerido |
|-------|------|-----------|
| `pregunta` | `string` | ✅ |
| `opciones` | `array[string]` | ✅ (min 2) |
| `fechaCierre` | `string` (ISO date) | ❌ |

```json
{
  "pregunta": "¿Qué horario prefieres?",
  "opciones": ["Mañana", "Tarde", "Noche"],
  "fechaCierre": "2026-07-01"
}
```

### `GET /api/moderator/encuestas/:id/results`
**Auth:** Moderador

### `POST /api/moderator/encuestas/:id/answer`
**Auth:** ✅ Bearer token (`rol=conductor`)
| Campo | Tipo | Requerido |
|-------|------|-----------|
| `opcionElegida` | `string` | ✅ (debe estar en `opciones` de la encuesta) |

```json
{
  "opcionElegida": "Mañana"
}
```

---

## 17. Avisos — `/api/avisos`

### `GET /api/avisos`
**Auth:** ✅ Bearer token (cualquier rol)
**Query Params:** `page` (default 1), `limit` (default 20)

### `POST /api/avisos`
**Auth:** ✅ Bearer token (`rol=conductor` o `esModerador`)

| Campo | Tipo | Requerido |
|-------|------|-----------|
| `contenido` | `string` (no vacío) | ✅ |

```json
{
  "contenido": "¡Buenos días a todos!"
}
```

### `PUT /api/avisos/:id/pin`
**Auth:** ✅ Bearer token (`esModerador`)
**Body:** Ninguno

### `DELETE /api/avisos/:id`
**Auth:** ✅ Bearer token (`esModerador`)
**Body:** Ninguno

---

## 18. Admin — `/api/admin`

**Middleware base:** `auth()`, `admin()` (requiere `rol=admin`)

---

### `GET /api/admin/dashboard`
**Body:** Ninguno

### `GET /api/admin/users`
**Query:** `page` (default 1), `limit` (default 20)

### `GET /api/admin/drivers`
**Query:** `page` (default 1), `limit` (default 20)

### `GET /api/admin/trips`
**Query:** `page` (default 1), `limit` (default 20)

### `GET /api/admin/earnings`
**Query:** `page` (default 1), `limit` (default 20)

---

### `PUT /api/admin/users/:id`

| Campo | Tipo | Requerido |
|-------|------|-----------|
| `nombre` | `string` | ❌ |
| `apellido` | `string` | ❌ |
| `email` | `string` | ❌ (único) |
| `telefono` | `string` | ❌ |
| `edad` | `number` | ❌ |

```json
{
  "nombre": "NuevoNombre",
  "apellido": "NuevoApellido",
  "email": "nuevo@email.com",
  "telefono": "3001112233",
  "edad": 35
}
```

### `PUT /api/admin/users/:id/suspend`
**Body:** Ninguno

### `PUT /api/admin/users/:id/avatar`
**Tipo:** `multipart/form-data`
| Campo | Tipo | Requerido | Descripción |
|-------|------|-----------|-------------|
| `file` | `file` | ✅ | Imagen (jpg/jpeg/png/gif/webp, máx 5MB) |

### `DELETE /api/admin/users/:id`
**Body:** Ninguno

### `PUT /api/admin/users/:id/clear-debt`
**Body:** Ninguno

### `PUT /api/admin/users/:id/moderator`

| Campo | Tipo | Requerido | Valores |
|-------|------|-----------|---------|
| `esModerador` | `boolean` | ❌ | |
| `zonaModerador` | `string` | ❌ | `"cali"`, `"popayan"`, `"pasto"` |

```json
{
  "esModerador": true,
  "zonaModerador": "cali"
}
```

### `PUT /api/admin/users/:id/leader`
**Nota:** Ruta definida pero método NO implementado en el controlador.

---

### `GET /api/admin/profile`
**Body:** Ninguno

### `PUT /api/admin/profile`

| Campo | Tipo | Requerido |
|-------|------|-----------|
| `nombre` | `string` | ❌ |
| `apellido` | `string` | ❌ |
| `email` | `string` | ❌ |
| `telefono` | `string` | ❌ |

### `POST /api/admin/profile/avatar`
**Tipo:** `multipart/form-data`
| Campo | Tipo | Requerido | Descripción |
|-------|------|-----------|-------------|
| `file` | `file` | ✅ | Imagen (jpg/jpeg/png/gif/webp, máx 5MB) |

---

### `GET /api/admin/emergencies`
**Query:** `page` (default 1), `limit` (default 20)

### `PUT /api/admin/emergencies/:id/resolve`
**Body:** Ninguno

---

### `GET /api/admin/commissions`
**Body:** Ninguno

### `PUT /api/admin/commissions/:conductorId/paid`
**Body:** Ninguno

### `GET /api/admin/commissions/:conductorId/history`
**Query:** `page` (default 1), `limit` (default 20)

---

### `GET /api/admin/reports`
**Query:** `page` (default 1), `limit` (default 20)

### `PUT /api/admin/reports/:id/resolve`
**Body:** Ninguno

---

### `GET /api/admin/disputes`
**Query:** `page` (default 1), `limit` (default 20)

### `PUT /api/admin/disputes/:id/resolve`

| Campo | Tipo | Requerido | Valores |
|-------|------|-----------|---------|
| `resultado` | `string` | ✅ | `"favor_conductor"`, `"favor_cliente"` |
| `acuerdoDePago` | `boolean` | ❌ | |
| `montoDeuda` | `number` | ❌ | |

```json
{
  "resultado": "favor_conductor",
  "acuerdoDePago": true,
  "montoDeuda": 15000
}
```

---

### `GET /api/admin/verifications`
**Query:** `page` (default 1), `limit` (default 20)

### `PUT /api/admin/verifications/:conductorId/approve`
**Body:** Ninguno

### `PUT /api/admin/verifications/:conductorId/reject`

| Campo | Tipo | Requerido |
|-------|------|-----------|
| `nota` | `string` | ❌ |

```json
{
  "nota": "Documento ilegible"
}
```

---

### `GET /api/admin/payments/pending`
**Body:** Ninguno

### `PUT /api/admin/payments/:userId/confirm`
**Body:** Ninguno

### `PUT /api/admin/payments/:userId/reject`
**Body:** Ninguno

---

### `PUT /api/admin/config`

| Campo | Tipo | Requerido |
|-------|------|-----------|
| `nequiNumero` | `string` | ❌ |
| `nequiNombre` | `string` | ❌ |

```json
{
  "nequiNumero": "3001234567",
  "nequiNombre": "CargaExpress SAS"
}
```

### `PUT /api/admin/config/coverage`

| Campo | Tipo | Requerido |
|-------|------|-----------|
| `zonasCobertura` | `array` | ✅ |

```json
{
  "zonasCobertura": [
    { "nombre": "Cali", "centro": { "lat": 3.4516, "lng": -76.532 }, "radio": 20 }
  ]
}
```

### `PUT /api/admin/config/banner`
**Tipo:** `multipart/form-data`

| Campo | Tipo | Requerido | Descripción |
|-------|------|-----------|-------------|
| `banner_imagen` | `file` | ❌ | Imagen (jpg/jpeg/png/gif/webp, máx 2MB) |
| `bannerActivo` | `boolean` | ❌ | Acepta `true` o `"true"` |
| `bannerLink` | `string` | ❌ | |
| `bannerTexto` | `string` | ❌ | |

---

### `PUT /api/admin/comunicados/:id/approve`
**Body:** Ninguno

### `PUT /api/admin/comunicados/:id/reject`

| Campo | Tipo | Requerido |
|-------|------|-----------|
| `notaRechazo` | `string` | ❌ |

### `PUT /api/admin/encuestas/:id/approve`
**Body:** Ninguno

---

### `GET /api/admin/moderator-reports`
**Query:** `page` (default 1), `limit` (default 20)

### `GET /api/admin/backups`
**Body:** Ninguno

### `POST /api/admin/backups/run`
**Body:** Ninguno

---

### `GET /api/admin/cancellation-requests`
**Query:** `page` (default 1), `limit` (default 20)

### `POST /api/admin/cancellation-requests/:id/approve`
**Body:** Ninguno

### `POST /api/admin/cancellation-requests/:id/reject`
**Body:** Ninguno

---

## 19. Líder — `/api/leader`

**Middleware base:** `auth()`, `leader()`, `leaderPermission({ permission: '...' })`
(Requiere que el usuario tenga `extra_roles` que incluya `"leader"` + el permiso específico)

### `GET /api/leader/avisos`
**Permiso:** `avisos.read`
**Query:** `page` (default 1), `limit` (default 20)

### `POST /api/leader/avisos`
**Permiso:** `avisos.write`

| Campo | Tipo | Requerido |
|-------|------|-----------|
| `contenido` | `string` | ✅ |

```json
{
  "contenido": "Aviso para los conductores"
}
```

### `PUT /api/leader/avisos/:id/pin`
**Permiso:** `avisos.pin`

### `DELETE /api/leader/avisos/:id`
**Permiso:** `avisos.delete` (solo posts propios)

---

### `POST /api/leader/comunicados`
**Permiso:** `announcements.create`
**Middleware adicional:** `rateLimit(5/min)`

| Campo | Tipo | Requerido |
|-------|------|-----------|
| `titulo` | `string` | ✅ |
| `contenido` | `string` | ✅ |

```json
{
  "titulo": "Comunicado oficial",
  "contenido": "Mensaje importante para la comunidad"
}
```

### `GET /api/leader/comunicados`
**Permiso:** `announcements.read`

---

### `GET /api/leader/drivers`
**Permiso:** `drivers.view_limited`
**Query:** `page` (default 1), `limit` (default 20)

### `GET /api/leader/reports`
**Permiso:** `reports.view_limited`

---

## Resumen de Archivos Multipart

| Endpoint | Campo | Tipos | Máx |
|----------|-------|-------|-----|
| `POST /api/users/avatar` | `file` | jpg/jpeg/png/gif/webp | 5MB |
| `POST /api/drivers/vehicle-photo` | `file` | jpg/jpeg/png/gif/webp | 5MB |
| `POST /api/drivers/driver-photo` | `file` | jpg/jpeg/png/gif/webp | 5MB |
| `POST /api/drivers/verification/cedula` | `file` | jpg/jpeg/png/gif/webp | 5MB |
| `POST /api/drivers/verification/licencia` | `file` | jpg/jpeg/png/gif/webp | 5MB |
| `POST /api/drivers/verification/vehiculo` | `file` | jpg/jpeg/png/gif/webp | 5MB |
| `POST /api/trips/:id/delivery-photo` | `file` | jpg/jpeg/png/gif/webp | 5MB |
| `POST /api/trips/:id/dispute/support` | `file` | jpg/jpeg/png/gif/webp/pdf | 5MB |
| `PUT /api/admin/users/:id/avatar` | `file` | jpg/jpeg/png/gif/webp | 5MB |
| `POST /api/admin/profile/avatar` | `file` | jpg/jpeg/png/gif/webp | 5MB |
| `PUT /api/admin/config/banner` | `banner_imagen` | jpg/jpeg/png/gif/webp | 2MB |
| `POST /api/payment/proof` | `file` | jpg/jpeg/png/gif/webp/pdf | 5MB |

---

## Resumen de Roles y Accesos

| Rol | Acceso |
|-----|--------|
| **Sin auth** | `/`, `/metrics`, `/health`, `/storage/uploads/*`, `/swagger`, `/docs`, `/api/config/banner` |
| **Cualquier autenticado** | Perfil, viajes (con restricciones), favoritos, notificaciones, soporte, settings, mapbox, emergencia, avisos (GET), pagos, disputas (propias) |
| **Cliente** | Solicitar viajes, ver ofertas, aceptar/rechazar ofertas, calificar, disputar |
| **Conductor** | Estado online, ubicación, crear ofertas, iniciar/completar/finalizar viajes, reportar clientes, subir fotos, ganancias |
| **Moderador** (`esModerador`) | Todos `/api/moderator/*`, avisos (pin/delete), comunicados, encuestas |
| **Líder** (`esLider` + `extra_roles`) | `/api/leader/*` con permisos: `avisos.*`, `announcements.*`, `drivers.view_limited`, `reports.view_limited` |
| **Admin** (`rol=admin`) | Todos `/api/admin/*` — control total del sistema |

---

## Headers Especiales

| Header | Endpoints | Descripción |
|--------|-----------|-------------|
| `Authorization: Bearer <token>` | Todos los protegidos | Token de acceso (expira en 7 días) |
| `X-Idempotency-Key: <uuid>` | `POST /api/trips/request`, `POST /api/trips/:id/complete`, `POST /api/trips/:id/finalize` | Previene duplicados (TTL 60s) |
