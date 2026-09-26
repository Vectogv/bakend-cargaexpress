# Tickets de soporte — contrato de API

Un cliente o conductor abre un ticket desde la app (opcionalmente ligado a un
viaje) y lo atiende un moderador de su zona o el admin por un hilo de mensajes.

Todas las rutas requieren `Authorization: Bearer <token>`. Los errores llegan
siempre como `{ "error": "mensaje legible" }`.

- Categorías: `pago | viaje | cuenta | app | otro`
- Estados: `abierto → en_proceso → resuelto → cerrado` (el staff puede poner
  cualquiera; el usuario solo puede **cerrar** el suyo).
- Zona del ticket: la del viaje (ciudad del conductor u origen), si no la
  ciudad del conductor que lo abre, si no la del último viaje del cliente, y como
  último recurso el campo opcional `zona` que mande la app. Puede quedar `null`
  (solo el admin lo ve).

## Rutas de la app (cliente / conductor) — `/api/support/tickets`

| Método | Ruta | Descripción |
| --- | --- | --- |
| `POST` | `/api/support/tickets` | Crear ticket (JSON o multipart). 10/min por usuario. |
| `POST` | `/api/support/tickets/upload` | Subir una imagen aparte y obtener su ruta. |
| `GET` | `/api/support/tickets?estado=&page=&limit=` | Mis tickets (paginado). |
| `GET` | `/api/support/tickets/:id` | Detalle con el hilo `mensajes`. |
| `POST` | `/api/support/tickets/:id/messages` | Escribir en el hilo (JSON o multipart). |
| `POST` | `/api/support/tickets/:id/close` | Cerrar mi ticket. |

### Crear ticket

JSON:

```json
{
  "categoria": "pago",
  "asunto": "Cobro duplicado",
  "descripcion": "Me cobraron dos veces el mismo viaje del martes.",
  "viajeId": 123,
  "adjunto": "/storage/uploads/ticket-….png",
  "zona": "popayan"
}
```

- `categoria`, `asunto` (3–150) y `descripcion` (10–2000) son obligatorios.
- `viajeId` opcional: debe existir (404) y el usuario debe ser cliente o
  conductor de ese viaje (403).
- `adjunto` opcional: ruta devuelta por `/upload` (con o sin firma).
- `zona` opcional: solo se usa si no se pudo deducir.

Multipart (`multipart/form-data`) con los mismos campos como `fields` y la
imagen en el campo **`file`** (jpg, jpeg, png, webp, heic; máx. 10 MB).

Respuesta `201` (mismo JSON que el detalle):

```json
{
  "id": 12,
  "categoria": "pago",
  "asunto": "Cobro duplicado",
  "descripcion": "Me cobraron dos veces el mismo viaje del martes.",
  "adjunto": "/storage/uploads/ticket-9f1c….png?exp=1758850000&sig=…",
  "estado": "abierto",
  "zona": "popayan",
  "viajeId": 123,
  "viaje": { "id": 123, "estado": "finalizado", "origenDireccion": "…", "destinoDireccion": "…" },
  "usuario": { "id": 45, "nombre": "Ana Pérez", "rol": "cliente", "avatar": null },
  "moderador": null,
  "totalMensajes": 0,
  "ultimoMensajeAt": "2026-09-25T20:10:00.000-05:00",
  "resueltoAt": null,
  "cerradoAt": null,
  "createdAt": "2026-09-25T20:10:00.000-05:00",
  "updatedAt": "2026-09-25T20:10:00.000-05:00",
  "mensajes": []
}
```

`moderador` cuando hay alguien atendiendo: `{ "id": 7, "nombre": "Luis Mod" }`
(al usuario no se le exponen zona ni contacto del staff).

Errores: `403` rol no permitido (admin) o viaje ajeno · `404` viaje inexistente
· `422` validación / adjunto inválido · `429` demasiadas solicitudes.

### Subir adjunto aparte

`POST /api/support/tickets/upload` multipart con campo `file`.

```json
{ "adjunto": "/storage/uploads/ticket-9f1c….png", "url": "/storage/uploads/ticket-9f1c….png?exp=…&sig=…" }
```

Guarda `adjunto` para mandarlo al crear el ticket o el mensaje. Los adjuntos
son privados: solo se sirven con la URL firmada (`url`) que la API devuelve en
cada lectura (vigencia 1 h). Sin firma responde `403`. `400` si no hay archivo,
`422` si no es imagen.

### Listar mis tickets

`GET /api/support/tickets?estado=abierto,en_proceso&page=1&limit=20`

```json
{
  "tickets": [ { "...ticket sin mensajes", "totalMensajes": 3 } ],
  "meta": { "total": 1, "page": 1, "perPage": 20, "lastPage": 1 }
}
```

`estado` acepta uno o varios separados por coma; un valor desconocido → `422`.
Orden: última actividad primero.

### Detalle

`GET /api/support/tickets/:id` → ticket con `mensajes` (ascendente). `404` si no
existe o no es del usuario.

Mensaje:

```json
{
  "id": 90,
  "ticketId": 12,
  "autor": { "id": 7, "nombre": "Luis Mod", "avatar": null },
  "rolAutor": "moderador",
  "mensaje": "Hola, ya estamos revisando el cobro.",
  "adjunto": null,
  "createdAt": "2026-09-25T20:15:00.000-05:00"
}
```

`rolAutor`: `usuario | moderador | admin`.

### Escribir en el hilo

`POST /api/support/tickets/:id/messages`

- JSON: `{ "mensaje": "texto (1–2000)", "adjunto": "/storage/uploads/ticket-….png" }`
- o multipart: `mensaje` + `file`.

Respuesta `201`: el mensaje (formato de arriba) más `ticketEstado`. Si el ticket
estaba `resuelto`, vuelve a `en_proceso`. `422` si está `cerrado` o el mensaje
está vacío. `404` si no es tuyo.

### Cerrar

`POST /api/support/tickets/:id/close` → ticket con `estado: "cerrado"` y
`cerradoAt`. `422` si ya estaba cerrado.

## Tiempo real (Socket.IO)

El usuario recibe en su sala habitual (`client:{id}` / `driver:{id}`):

| Evento | Cuándo | Payload |
| --- | --- | --- |
| `ticket:mensaje` | El staff responde | `{ ticketId, estado, zona, usuarioId, moderadorId, mensaje: {…mensaje} }` |
| `ticket:estado` | Cambio de estado, toma o asignación | `{ id, categoria, asunto, estado, zona, usuarioId, moderadorId, viajeId, createdAt, updatedAt, moderador: {id, nombre} \| null, actorId }` |
| `notification:new` | Se guardó la notificación in-app (`tipo`: `ticket_mensaje` / `ticket_estado`) | notificación |

El staff recibe `ticket:nuevo` (moderadores de la zona + admin), `ticket:mensaje`
(moderador asignado o zona, y admin), `ticket:estado` y `ticket:asignado`
(solo el moderador al que el admin le asigna).

## Push (FCM)

Cuando el staff responde:

- `notification`: título `Respuesta a tu ticket #12`, cuerpo = texto del mensaje.
- `data`: `{ "tipo": "ticket_mensaje", "ticketId": "12", "mensajeId": "90", "estado": "en_proceso" }`

Cuando el staff toma o cambia el estado:

- título `Ticket #12 marcado como resuelto` (o `tomado por soporte`, `cerrado`, `reabierto`), cuerpo = asunto.
- `data`: `{ "tipo": "ticket_estado", "ticketId": "12", "estado": "resuelto" }`

Todos los valores de `data` son strings. Al tocar la notificación la app debería
abrir el detalle del ticket `ticketId`.

## Rutas de staff (panel web)

Moderador (`/api/moderator/tickets`, solo su zona) y admin
(`/api/admin/tickets`, todas las zonas):

| Método | Ruta | Descripción |
| --- | --- | --- |
| `GET` | `…/tickets?estado=&mios=1&page=&limit=` (+ `zona=` solo admin) | Bandeja. |
| `GET` | `…/tickets/count` | `{ abiertos, enProceso, total }`. |
| `GET` | `…/tickets/moderators?zona=` | Moderadores asignables. |
| `GET` | `…/tickets/:id` | Detalle con hilo (aquí `usuario` sí trae `email`/`telefono`). |
| `POST` | `…/tickets/:id/take` | Tomar: asigna al moderador y pasa a `en_proceso`. `409` si otro lo tiene. |
| `POST` | `…/tickets/:id/messages` | Responder (asigna si nadie lo tenía; `422` si está cerrado). |
| `PUT` | `…/tickets/:id/status` `{ estado }` | Cambiar estado. |
| `PUT` | `/api/admin/tickets/:id/assign` `{ moderadorId \| null }` | Solo admin. `422` si no es moderador o es de otra zona. |

Un moderador de otra zona recibe `403` en cualquier ticket ajeno; un ticket sin
zona solo lo ve el admin.
