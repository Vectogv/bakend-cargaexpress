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
    router.post('vehicle-photo', [controllers.Driver, 'vehiclePhoto'])
    router.put('location', [controllers.Driver, 'location'])
    router.post('driver-photo', [controllers.Driver, 'driverPhoto'])
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
    router.get('help', [controllers.Support, 'help'])
    router.get('emergency', [controllers.Support, 'emergency'])
  })
  .prefix('/api/support')
  .as('support')

router.get('/swagger', async () => {
  return AutoSwagger.default.docs(router.toJSON(), swagger)
})

router.get('/docs', async () => {
  return AutoSwagger.default.scalar('/swagger')
})
