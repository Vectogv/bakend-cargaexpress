import { middleware } from '#start/kernel'
import router from '@adonisjs/core/services/router'
import { controllers } from '#generated/controllers'
import app from '@adonisjs/core/services/app'
import fs from 'node:fs'
import AutoSwagger from 'adonis-autoswagger'
import swagger from '#config/swagger'

router.get('/', () => {
  return { hello: 'world' }
})


router.get('/health', async ({ response }) => {
  // Endpoint de health check para load balancers, k8s, etc.
  // Retorna 200 si el servidor está operativo.
  return response.status(200).send({ status: 'ok', timestamp: new Date().toISOString() })
})

router.get('/storage/uploads/:fileName', async ({ params, response }) => {
  // Sanitize fileName to prevent path traversal attacks
  const rawName = params.fileName as string
  const safeName = require('node:path').basename(rawName)
  // Reject if the sanitized name differs (contained path separators or ..)
  if (!safeName || safeName !== rawName || safeName.startsWith('.')) {
    return response.status(400).send({ error: 'Invalid file name' })
  }
  const filePath = app.makePath('storage', 'uploads', safeName)
  if (!fs.existsSync(filePath)) {
    return response.status(404).send({ error: 'File not found' })
  }
  return response.download(filePath)
})

router
  .group(() => {
    router.post('register', [controllers.Auth, 'register'])
    router.post('login', [controllers.Auth, 'login'])
    router.post('refresh-token', [controllers.Auth, 'refreshToken'])
    // Cierra sesión: revoca el access token actual
    router.post('logout', [controllers.Auth, 'logout'])
  })
  .prefix('/api/auth')
  .as('auth')
  .use(middleware.rateLimit({ max: 10, windowMs: 60_000 })) // 10 intentos / minuto por IP

router
  .group(() => {
    router.get('profile', [controllers.Profile, 'show'])
    router.put('profile', [controllers.Profile, 'update'])
    router.post('avatar', [controllers.Profile, 'avatar'])
    router.put('fcm-token', [controllers.Profile, 'updateFcmToken'])
  })
  .prefix('/api/users')
  .as('users')
  .use(middleware.auth())

router
  .group(() => {
    router.put('status', [controllers.Driver, 'status'])
    router.get('earnings', [controllers.Driver, 'earnings'])
    router.get('stats', [controllers.Driver, 'stats'])
    router.get('today-stats', [controllers.Driver, 'todayStats'])
    router.get('earnings/history', [controllers.Driver, 'earningsHistory'])
    router.get('earnings/pdf', [controllers.Driver, 'earningsPDF'])
    router.post('vehicle-photo', [controllers.Driver, 'vehiclePhoto'])
    router.put('location', [controllers.Driver, 'location'])
    router.post('driver-photo', [controllers.Driver, 'driverPhoto'])
    router.post('verification/cedula', [controllers.Driver, 'uploadCedula'])
    router.post('verification/licencia', [controllers.Driver, 'uploadLicencia'])
    router.post('verification/vehiculo', [controllers.Driver, 'uploadVehiculo'])
  })
  .prefix('/api/drivers')
  .as('drivers')
  .use(middleware.auth())

router
  .group(() => {
    router.post('request', [controllers.Trip, 'request'])
      .use([middleware.rateLimit({ max: 5, windowMs: 60_000 }), middleware.idempotency()])
    router.get('nearby', [controllers.Trip, 'nearby'])
    router.get('active', [controllers.Trip, 'active'])
    router.get('history', [controllers.Trip, 'history'])
    router.get(':id', [controllers.Trip, 'show'])
    router.post(':id/accept', [controllers.Trip, 'accept']) // @deprecated — usar POST :id/offers/:offerId/accept
    router.post(':id/decline', [controllers.Trip, 'decline'])
    router.post(':id/start-trip', [controllers.Trip, 'startTrip'])
    router.post(':id/complete', [controllers.Trip, 'complete'])
      .use([middleware.rateLimit({ max: 5, windowMs: 60_000 }), middleware.idempotency()])
    router.post(':id/finalize', [controllers.Trip, 'finalize'])
      .use([middleware.rateLimit({ max: 5, windowMs: 60_000 }), middleware.idempotency()])
    router.post(':id/cancel', [controllers.Trip, 'cancel'])
    router.post(':id/request-cancellation', [controllers.Trip, 'requestCancellation'])
    router.post(':id/rate', [controllers.Trip, 'rate'])
    router.post(':id/delivery-photo', [controllers.Trip, 'deliveryPhoto'])
    router.get(':id/chat', [controllers.Chat, 'index'])
    router.post(':id/chat', [controllers.Chat, 'store'])
    router.post(':id/dispute', [controllers.Dispute, 'store'])
    router.post(':id/dispute/appeal', [controllers.Dispute, 'appeal'])
    router.post(':id/dispute/support', [controllers.Dispute, 'uploadSupport'])
    router.get(':id/offers', [controllers.Offer, 'index'])
    router.post(':id/offers', [controllers.Offer, 'store'])
      .use(middleware.rateLimit({ max: 10, windowMs: 60_000 }))
    router.post(':id/offers/:offerId/accept', [controllers.Offer, 'accept'])
    router.post(':id/report', [controllers.Report, 'store'])
  })
  .prefix('/api/trips')
  .as('trips')
  .use(middleware.auth())

router
  .group(() => {
    router.get('', [controllers.Notification, 'index'])
    router.put(':id/read', [controllers.Notification, 'read'])
  })
  .prefix('/api/notifications')
  .as('notifications')
  .use(middleware.auth())

router
  .group(() => {
    router.get('dashboard', [controllers.Admin, 'dashboard'])
    router.get('users', [controllers.Admin, 'users'])
    router.get('drivers', [controllers.Admin, 'drivers'])
    router.get('trips', [controllers.Admin, 'trips'])
    router.get('earnings', [controllers.Admin, 'earnings'])
    router.put('users/:id', [controllers.Admin, 'updateUser'])
    router.put('users/:id/suspend', [controllers.Admin, 'toggleSuspendUser'])
    router.put('users/:id/avatar', [controllers.Admin, 'uploadUserAvatar'])
    router.delete('users/:id', [controllers.Admin, 'deleteUser'])
    router.get('profile', [controllers.Admin, 'profile'])
    router.get('emergencies', [controllers.Admin, 'emergencies'])
    router.put('emergencies/:id/resolve', [controllers.Admin, 'resolveEmergency'])
    router.put('profile', [controllers.Admin, 'updateProfile'])
    router.post('profile/avatar', [controllers.Admin, 'uploadProfileAvatar'])
    router.get('commissions', [controllers.Admin, 'conductorDebt'])
    router.put('commissions/:conductorId/paid', [controllers.Admin, 'markCommissionPaid'])
    router.get('commissions/:conductorId/history', [controllers.Admin, 'commissionHistory'])
    router.get('reports', [controllers.Admin, 'reports'])
    router.put('reports/:id/resolve', [controllers.Admin, 'resolveReport'])
    router.get('disputes', [controllers.Admin, 'disputes'])
    router.put('disputes/:id/resolve', [controllers.Admin, 'resolveDispute'])
    router.put('users/:id/clear-debt', [controllers.Admin, 'clearDebt'])
    router.get('verifications', [controllers.Admin, 'pendingVerifications'])
    router.put('verifications/:conductorId/approve', [controllers.Admin, 'approveDriver'])
    router.put('verifications/:conductorId/reject', [controllers.Admin, 'rejectDriver'])
    router.get('payments/pending', [controllers.Admin, 'pendingPayments'])
    router.put('payments/:userId/confirm', [controllers.Admin, 'confirmPayment'])
    router.put('payments/:userId/reject', [controllers.Admin, 'rejectPayment'])
    router.put('config', [controllers.Admin, 'updateConfig'])
    router.put('config/coverage', [controllers.Admin, 'updateCoverage'])
    router.put('config/banner', [controllers.Admin, 'updateBanner'])
    router.put('users/:id/moderator', [controllers.Admin, 'assignModerator'])
    router.put('users/:id/leader', [controllers.Admin, 'assignLeader'])     // Asignar/quitar rol leader a conductor
    router.put('comunicados/:id/approve', [controllers.Admin, 'approveComunicado'])
    router.put('comunicados/:id/reject', [controllers.Admin, 'rejectComunicado'])
    router.put('encuestas/:id/approve', [controllers.Admin, 'approveEncuesta'])
    router.get('moderator-reports', [controllers.Admin, 'moderatorReports'])
    router.get('backups', [controllers.Admin, 'backupLogs'])
    router.post('backups/run', [controllers.Admin, 'manualBackup'])
    router.get('cancellation-requests', [controllers.Admin, 'cancellationRequests'])
    router.post('cancellation-requests/:id/approve', [controllers.Admin, 'approveCancellation'])
    router.post('cancellation-requests/:id/reject', [controllers.Admin, 'rejectCancellation'])
  })
  .prefix('/api/admin')
  .as('admin')
  .use([middleware.auth(), middleware.admin()])

router
  .group(() => {
    router.get('', [controllers.FavoriteRoute, 'index'])
    router.post('', [controllers.FavoriteRoute, 'store'])
    router.delete(':id', [controllers.FavoriteRoute, 'destroy'])
  })
  .prefix('/api/favorites')
  .as('favorites')
  .use(middleware.auth())

router
  .group(() => {
    router.get('help', [controllers.Support, 'help'])
    router.get('emergency', [controllers.Support, 'emergency'])
  })
  .prefix('/api/support')
  .as('support')
  .use(middleware.auth())

router
  .group(() => {
    router.get('debt', [controllers.Payment, 'info'])
    router.post('proof', [controllers.Payment, 'uploadProof'])
  })
  .prefix('/api/payment')
  .as('payment')
  .use(middleware.auth())

router.get('/api/config/banner', async ({ serialize }) => {
  const ConfiguracionPlataforma = await import('#models/configuracion_plataforma').then(
    (m) => m.default
  )
  const config = await ConfiguracionPlataforma.first()
  if (!config) {
    return serialize.withoutWrapping({ activo: false, imagenUrl: null, link: null, texto: null })
  }
  return serialize.withoutWrapping({
    activo: config.bannerActivo || false,
    imagenUrl: config.bannerImagenUrl || null,
    link: config.bannerLink || null,
    texto: config.bannerTexto || null,
  })
})

router
  .group(() => {
    router.post('comunicados', [controllers.Moderator, 'storeComunicado'])
    router.get('comunicados', [controllers.Moderator, 'myComunicados'])
    router.get('drivers', [controllers.Moderator, 'driversList'])
    router.get('drivers/inactive', [controllers.Moderator, 'inactiveDrivers'])
    router.post('drivers/:id/notify', [controllers.Moderator, 'notifyDriver'])
    router.post('drivers/:id/report', [controllers.Moderator, 'reportDriver'])
    router.post('encuestas', [controllers.Moderator, 'storeEncuesta'])
    router.get('encuestas/:id/results', [controllers.Moderator, 'encuestaResults'])
    router.post('encuestas/:id/answer', [controllers.Moderator, 'answerEncuesta'])
  })
  .prefix('/api/moderator')
  .as('moderator')
  .use([middleware.auth(), middleware.moderator()])

router
  .group(() => {
    router.get('', [controllers.Moderator, 'avisosIndex'])
    router.post('', [controllers.Moderator, 'avisosStore'])
    router.put(':id/pin', [controllers.Moderator, 'avisosPin'])
    router.delete(':id', [controllers.Moderator, 'avisosDelete'])
  })
  .prefix('/api/avisos')
  .as('avisos')
  .use(middleware.auth())

router
  .post('/api/emergency', [controllers.Emergency, 'trigger'])
  .as('emergency.trigger')
  .use(middleware.auth())

router.get('/swagger', async () => {
  return AutoSwagger.default.docs(router.toJSON(), swagger)
})

router.get('/docs', async () => {
  return AutoSwagger.default.scalar('/swagger')
})

// ─────────────────────────────────────────────────────────────────────────────
// LÍDER DE CONDUCTORES
// Prefix: /api/leader
// Middleware: auth() + leader()          → verifica driver + extra_roles["leader"]
//             leaderPermission(permiso)  → verifica permiso granular por ruta
//
// ACCESO DENEGADO A:
//   /api/admin/*  /api/payment/*  verificación  datos financieros
//   chats privados  config del sistema  eliminación de usuarios
// ─────────────────────────────────────────────────────────────────────────────
router
  .group(() => {
    // Avisos — ver todos los posts
    router
      .get('avisos', [controllers.Leader, 'avisosIndex'])
      .use(middleware.leaderPermission({ permission: 'avisos.read' }))

    // Avisos — crear post propio
    router
      .post('avisos', [controllers.Leader, 'avisosStore'])
      .use(middleware.leaderPermission({ permission: 'avisos.write' }))

    // Avisos — fijar/desfijar post
    router
      .put('avisos/:id/pin', [controllers.Leader, 'avisosPin'])
      .use(middleware.leaderPermission({ permission: 'avisos.pin' }))

    // Avisos — eliminar post propio únicamente
    router
      .delete('avisos/:id', [controllers.Leader, 'avisosDelete'])
      .use(middleware.leaderPermission({ permission: 'avisos.delete' }))

    // Comunicados — crear (queda "pendiente", requiere aprobación de admin)
    router
      .post('comunicados', [controllers.Leader, 'storeComunicado'])
      .use([
        middleware.rateLimit({ max: 5, windowMs: 60_000 }),
        middleware.leaderPermission({ permission: 'announcements.create' }),
      ])

    // Comunicados — ver solo los suyos
    router
      .get('comunicados', [controllers.Leader, 'myComunicados'])
      .use(middleware.leaderPermission({ permission: 'announcements.read' }))

    // Conductores — lista básica sin datos sensibles
    router
      .get('drivers', [controllers.Leader, 'driversList'])
      .use(middleware.leaderPermission({ permission: 'drivers.view_limited' }))

    // Reportes — conteos y tipos, sin datos identificatorios
    router
      .get('reports', [controllers.Leader, 'reportsLimited'])
      .use(middleware.leaderPermission({ permission: 'reports.view_limited' }))
  })
  .prefix('/api/leader')
  .as('leader')
  .use([middleware.auth(), middleware.leader()])
