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

router.get('/storage/uploads/:fileName', async ({ params, response }) => {
  const filePath = app.makePath('storage', 'uploads', params.fileName)
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
  })
  .prefix('/api/auth')
  .as('auth')

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
    router.get('nearby', [controllers.Trip, 'nearby'])
    router.get('active', [controllers.Trip, 'active'])
    router.get('history', [controllers.Trip, 'history'])
    router.get(':id', [controllers.Trip, 'show'])
    router.post(':id/accept', [controllers.Trip, 'accept'])
    router.post(':id/decline', [controllers.Trip, 'decline'])
    router.post(':id/start-trip', [controllers.Trip, 'startTrip'])
    router.post(':id/complete', [controllers.Trip, 'complete'])
    router.post(':id/finalize', [controllers.Trip, 'finalize'])
    router.post(':id/cancel', [controllers.Trip, 'cancel'])
    router.post(':id/rate', [controllers.Trip, 'rate'])
    router.post(':id/delivery-photo', [controllers.Trip, 'deliveryPhoto'])
    router.get(':id/chat', [controllers.Chat, 'index'])
    router.post(':id/chat', [controllers.Chat, 'store'])
    router.post(':id/dispute', [controllers.Dispute, 'store'])
    router.post(':id/dispute/appeal', [controllers.Dispute, 'appeal'])
    router.post(':id/dispute/support', [controllers.Dispute, 'uploadSupport'])
    router.get(':id/offers', [controllers.Offer, 'index'])
    router.post(':id/offers', [controllers.Offer, 'store'])
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
    router.put('comunicados/:id/approve', [controllers.Admin, 'approveComunicado'])
    router.put('comunicados/:id/reject', [controllers.Admin, 'rejectComunicado'])
    router.put('encuestas/:id/approve', [controllers.Admin, 'approveEncuesta'])
    router.get('moderator-reports', [controllers.Admin, 'moderatorReports'])
    router.get('backups', [controllers.Admin, 'backupLogs'])
    router.post('backups/run', [controllers.Admin, 'manualBackup'])
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
    router.get('', [controllers.Moderator, 'foroIndex'])
    router.post('', [controllers.Moderator, 'foroStore'])
    router.put(':id/pin', [controllers.Moderator, 'foroPin'])
    router.delete(':id', [controllers.Moderator, 'foroDelete'])
  })
  .prefix('/api/foro')
  .as('foro')
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
