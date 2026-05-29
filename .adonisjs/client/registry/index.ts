/* eslint-disable prettier/prettier */
import type { AdonisEndpoint } from '@tuyau/core/types'
import type { Registry } from './schema.d.ts'
import type { ApiDefinition } from './tree.d.ts'

const placeholder: any = {}

const routes = {
  'auth.auth.register': {
    methods: ["POST"],
    pattern: '/api/auth/register',
    tokens: [{"old":"/api/auth/register","type":0,"val":"api","end":""},{"old":"/api/auth/register","type":0,"val":"auth","end":""},{"old":"/api/auth/register","type":0,"val":"register","end":""}],
    types: placeholder as Registry['auth.auth.register']['types'],
  },
  'auth.auth.login': {
    methods: ["POST"],
    pattern: '/api/auth/login',
    tokens: [{"old":"/api/auth/login","type":0,"val":"api","end":""},{"old":"/api/auth/login","type":0,"val":"auth","end":""},{"old":"/api/auth/login","type":0,"val":"login","end":""}],
    types: placeholder as Registry['auth.auth.login']['types'],
  },
  'auth.auth.refresh_token': {
    methods: ["POST"],
    pattern: '/api/auth/refresh-token',
    tokens: [{"old":"/api/auth/refresh-token","type":0,"val":"api","end":""},{"old":"/api/auth/refresh-token","type":0,"val":"auth","end":""},{"old":"/api/auth/refresh-token","type":0,"val":"refresh-token","end":""}],
    types: placeholder as Registry['auth.auth.refresh_token']['types'],
  },
  'users.profile.show': {
    methods: ["GET","HEAD"],
    pattern: '/api/users/profile',
    tokens: [{"old":"/api/users/profile","type":0,"val":"api","end":""},{"old":"/api/users/profile","type":0,"val":"users","end":""},{"old":"/api/users/profile","type":0,"val":"profile","end":""}],
    types: placeholder as Registry['users.profile.show']['types'],
  },
  'users.profile.update': {
    methods: ["PUT"],
    pattern: '/api/users/profile',
    tokens: [{"old":"/api/users/profile","type":0,"val":"api","end":""},{"old":"/api/users/profile","type":0,"val":"users","end":""},{"old":"/api/users/profile","type":0,"val":"profile","end":""}],
    types: placeholder as Registry['users.profile.update']['types'],
  },
  'users.profile.avatar': {
    methods: ["POST"],
    pattern: '/api/users/avatar',
    tokens: [{"old":"/api/users/avatar","type":0,"val":"api","end":""},{"old":"/api/users/avatar","type":0,"val":"users","end":""},{"old":"/api/users/avatar","type":0,"val":"avatar","end":""}],
    types: placeholder as Registry['users.profile.avatar']['types'],
  },
  'drivers.driver.status': {
    methods: ["PUT"],
    pattern: '/api/drivers/status',
    tokens: [{"old":"/api/drivers/status","type":0,"val":"api","end":""},{"old":"/api/drivers/status","type":0,"val":"drivers","end":""},{"old":"/api/drivers/status","type":0,"val":"status","end":""}],
    types: placeholder as Registry['drivers.driver.status']['types'],
  },
  'drivers.driver.earnings': {
    methods: ["GET","HEAD"],
    pattern: '/api/drivers/earnings',
    tokens: [{"old":"/api/drivers/earnings","type":0,"val":"api","end":""},{"old":"/api/drivers/earnings","type":0,"val":"drivers","end":""},{"old":"/api/drivers/earnings","type":0,"val":"earnings","end":""}],
    types: placeholder as Registry['drivers.driver.earnings']['types'],
  },
  'drivers.driver.stats': {
    methods: ["GET","HEAD"],
    pattern: '/api/drivers/stats',
    tokens: [{"old":"/api/drivers/stats","type":0,"val":"api","end":""},{"old":"/api/drivers/stats","type":0,"val":"drivers","end":""},{"old":"/api/drivers/stats","type":0,"val":"stats","end":""}],
    types: placeholder as Registry['drivers.driver.stats']['types'],
  },
  'drivers.driver.today_stats': {
    methods: ["GET","HEAD"],
    pattern: '/api/drivers/today-stats',
    tokens: [{"old":"/api/drivers/today-stats","type":0,"val":"api","end":""},{"old":"/api/drivers/today-stats","type":0,"val":"drivers","end":""},{"old":"/api/drivers/today-stats","type":0,"val":"today-stats","end":""}],
    types: placeholder as Registry['drivers.driver.today_stats']['types'],
  },
  'drivers.driver.vehicle_photo': {
    methods: ["POST"],
    pattern: '/api/drivers/vehicle-photo',
    tokens: [{"old":"/api/drivers/vehicle-photo","type":0,"val":"api","end":""},{"old":"/api/drivers/vehicle-photo","type":0,"val":"drivers","end":""},{"old":"/api/drivers/vehicle-photo","type":0,"val":"vehicle-photo","end":""}],
    types: placeholder as Registry['drivers.driver.vehicle_photo']['types'],
  },
  'drivers.driver.location': {
    methods: ["PUT"],
    pattern: '/api/drivers/location',
    tokens: [{"old":"/api/drivers/location","type":0,"val":"api","end":""},{"old":"/api/drivers/location","type":0,"val":"drivers","end":""},{"old":"/api/drivers/location","type":0,"val":"location","end":""}],
    types: placeholder as Registry['drivers.driver.location']['types'],
  },
  'drivers.driver.driver_photo': {
    methods: ["POST"],
    pattern: '/api/drivers/driver-photo',
    tokens: [{"old":"/api/drivers/driver-photo","type":0,"val":"api","end":""},{"old":"/api/drivers/driver-photo","type":0,"val":"drivers","end":""},{"old":"/api/drivers/driver-photo","type":0,"val":"driver-photo","end":""}],
    types: placeholder as Registry['drivers.driver.driver_photo']['types'],
  },
  'trips.trip.request': {
    methods: ["POST"],
    pattern: '/api/trips/request',
    tokens: [{"old":"/api/trips/request","type":0,"val":"api","end":""},{"old":"/api/trips/request","type":0,"val":"trips","end":""},{"old":"/api/trips/request","type":0,"val":"request","end":""}],
    types: placeholder as Registry['trips.trip.request']['types'],
  },
  'trips.trip.nearby': {
    methods: ["GET","HEAD"],
    pattern: '/api/trips/nearby',
    tokens: [{"old":"/api/trips/nearby","type":0,"val":"api","end":""},{"old":"/api/trips/nearby","type":0,"val":"trips","end":""},{"old":"/api/trips/nearby","type":0,"val":"nearby","end":""}],
    types: placeholder as Registry['trips.trip.nearby']['types'],
  },
  'trips.trip.active': {
    methods: ["GET","HEAD"],
    pattern: '/api/trips/active',
    tokens: [{"old":"/api/trips/active","type":0,"val":"api","end":""},{"old":"/api/trips/active","type":0,"val":"trips","end":""},{"old":"/api/trips/active","type":0,"val":"active","end":""}],
    types: placeholder as Registry['trips.trip.active']['types'],
  },
  'trips.trip.history': {
    methods: ["GET","HEAD"],
    pattern: '/api/trips/history',
    tokens: [{"old":"/api/trips/history","type":0,"val":"api","end":""},{"old":"/api/trips/history","type":0,"val":"trips","end":""},{"old":"/api/trips/history","type":0,"val":"history","end":""}],
    types: placeholder as Registry['trips.trip.history']['types'],
  },
  'trips.trip.show': {
    methods: ["GET","HEAD"],
    pattern: '/api/trips/:id',
    tokens: [{"old":"/api/trips/:id","type":0,"val":"api","end":""},{"old":"/api/trips/:id","type":0,"val":"trips","end":""},{"old":"/api/trips/:id","type":1,"val":"id","end":""}],
    types: placeholder as Registry['trips.trip.show']['types'],
  },
  'trips.trip.accept': {
    methods: ["POST"],
    pattern: '/api/trips/:id/accept',
    tokens: [{"old":"/api/trips/:id/accept","type":0,"val":"api","end":""},{"old":"/api/trips/:id/accept","type":0,"val":"trips","end":""},{"old":"/api/trips/:id/accept","type":1,"val":"id","end":""},{"old":"/api/trips/:id/accept","type":0,"val":"accept","end":""}],
    types: placeholder as Registry['trips.trip.accept']['types'],
  },
  'trips.trip.decline': {
    methods: ["POST"],
    pattern: '/api/trips/:id/decline',
    tokens: [{"old":"/api/trips/:id/decline","type":0,"val":"api","end":""},{"old":"/api/trips/:id/decline","type":0,"val":"trips","end":""},{"old":"/api/trips/:id/decline","type":1,"val":"id","end":""},{"old":"/api/trips/:id/decline","type":0,"val":"decline","end":""}],
    types: placeholder as Registry['trips.trip.decline']['types'],
  },
  'trips.trip.start_trip': {
    methods: ["POST"],
    pattern: '/api/trips/:id/start-trip',
    tokens: [{"old":"/api/trips/:id/start-trip","type":0,"val":"api","end":""},{"old":"/api/trips/:id/start-trip","type":0,"val":"trips","end":""},{"old":"/api/trips/:id/start-trip","type":1,"val":"id","end":""},{"old":"/api/trips/:id/start-trip","type":0,"val":"start-trip","end":""}],
    types: placeholder as Registry['trips.trip.start_trip']['types'],
  },
  'trips.trip.complete': {
    methods: ["POST"],
    pattern: '/api/trips/:id/complete',
    tokens: [{"old":"/api/trips/:id/complete","type":0,"val":"api","end":""},{"old":"/api/trips/:id/complete","type":0,"val":"trips","end":""},{"old":"/api/trips/:id/complete","type":1,"val":"id","end":""},{"old":"/api/trips/:id/complete","type":0,"val":"complete","end":""}],
    types: placeholder as Registry['trips.trip.complete']['types'],
  },
  'trips.trip.finalize': {
    methods: ["POST"],
    pattern: '/api/trips/:id/finalize',
    tokens: [{"old":"/api/trips/:id/finalize","type":0,"val":"api","end":""},{"old":"/api/trips/:id/finalize","type":0,"val":"trips","end":""},{"old":"/api/trips/:id/finalize","type":1,"val":"id","end":""},{"old":"/api/trips/:id/finalize","type":0,"val":"finalize","end":""}],
    types: placeholder as Registry['trips.trip.finalize']['types'],
  },
  'trips.trip.cancel': {
    methods: ["POST"],
    pattern: '/api/trips/:id/cancel',
    tokens: [{"old":"/api/trips/:id/cancel","type":0,"val":"api","end":""},{"old":"/api/trips/:id/cancel","type":0,"val":"trips","end":""},{"old":"/api/trips/:id/cancel","type":1,"val":"id","end":""},{"old":"/api/trips/:id/cancel","type":0,"val":"cancel","end":""}],
    types: placeholder as Registry['trips.trip.cancel']['types'],
  },
  'notifications.notification.index': {
    methods: ["GET","HEAD"],
    pattern: '/api/notifications',
    tokens: [{"old":"/api/notifications","type":0,"val":"api","end":""},{"old":"/api/notifications","type":0,"val":"notifications","end":""}],
    types: placeholder as Registry['notifications.notification.index']['types'],
  },
  'notifications.notification.read': {
    methods: ["PUT"],
    pattern: '/api/notifications/:id/read',
    tokens: [{"old":"/api/notifications/:id/read","type":0,"val":"api","end":""},{"old":"/api/notifications/:id/read","type":0,"val":"notifications","end":""},{"old":"/api/notifications/:id/read","type":1,"val":"id","end":""},{"old":"/api/notifications/:id/read","type":0,"val":"read","end":""}],
    types: placeholder as Registry['notifications.notification.read']['types'],
  },
  'admin.admin.dashboard': {
    methods: ["GET","HEAD"],
    pattern: '/api/admin/dashboard',
    tokens: [{"old":"/api/admin/dashboard","type":0,"val":"api","end":""},{"old":"/api/admin/dashboard","type":0,"val":"admin","end":""},{"old":"/api/admin/dashboard","type":0,"val":"dashboard","end":""}],
    types: placeholder as Registry['admin.admin.dashboard']['types'],
  },
  'admin.admin.users': {
    methods: ["GET","HEAD"],
    pattern: '/api/admin/users',
    tokens: [{"old":"/api/admin/users","type":0,"val":"api","end":""},{"old":"/api/admin/users","type":0,"val":"admin","end":""},{"old":"/api/admin/users","type":0,"val":"users","end":""}],
    types: placeholder as Registry['admin.admin.users']['types'],
  },
  'admin.admin.drivers': {
    methods: ["GET","HEAD"],
    pattern: '/api/admin/drivers',
    tokens: [{"old":"/api/admin/drivers","type":0,"val":"api","end":""},{"old":"/api/admin/drivers","type":0,"val":"admin","end":""},{"old":"/api/admin/drivers","type":0,"val":"drivers","end":""}],
    types: placeholder as Registry['admin.admin.drivers']['types'],
  },
  'admin.admin.trips': {
    methods: ["GET","HEAD"],
    pattern: '/api/admin/trips',
    tokens: [{"old":"/api/admin/trips","type":0,"val":"api","end":""},{"old":"/api/admin/trips","type":0,"val":"admin","end":""},{"old":"/api/admin/trips","type":0,"val":"trips","end":""}],
    types: placeholder as Registry['admin.admin.trips']['types'],
  },
  'admin.admin.earnings': {
    methods: ["GET","HEAD"],
    pattern: '/api/admin/earnings',
    tokens: [{"old":"/api/admin/earnings","type":0,"val":"api","end":""},{"old":"/api/admin/earnings","type":0,"val":"admin","end":""},{"old":"/api/admin/earnings","type":0,"val":"earnings","end":""}],
    types: placeholder as Registry['admin.admin.earnings']['types'],
  },
  'admin.admin.update_user': {
    methods: ["PUT"],
    pattern: '/api/admin/users/:id',
    tokens: [{"old":"/api/admin/users/:id","type":0,"val":"api","end":""},{"old":"/api/admin/users/:id","type":0,"val":"admin","end":""},{"old":"/api/admin/users/:id","type":0,"val":"users","end":""},{"old":"/api/admin/users/:id","type":1,"val":"id","end":""}],
    types: placeholder as Registry['admin.admin.update_user']['types'],
  },
  'admin.admin.toggle_suspend_user': {
    methods: ["PUT"],
    pattern: '/api/admin/users/:id/suspend',
    tokens: [{"old":"/api/admin/users/:id/suspend","type":0,"val":"api","end":""},{"old":"/api/admin/users/:id/suspend","type":0,"val":"admin","end":""},{"old":"/api/admin/users/:id/suspend","type":0,"val":"users","end":""},{"old":"/api/admin/users/:id/suspend","type":1,"val":"id","end":""},{"old":"/api/admin/users/:id/suspend","type":0,"val":"suspend","end":""}],
    types: placeholder as Registry['admin.admin.toggle_suspend_user']['types'],
  },
  'admin.admin.upload_user_avatar': {
    methods: ["PUT"],
    pattern: '/api/admin/users/:id/avatar',
    tokens: [{"old":"/api/admin/users/:id/avatar","type":0,"val":"api","end":""},{"old":"/api/admin/users/:id/avatar","type":0,"val":"admin","end":""},{"old":"/api/admin/users/:id/avatar","type":0,"val":"users","end":""},{"old":"/api/admin/users/:id/avatar","type":1,"val":"id","end":""},{"old":"/api/admin/users/:id/avatar","type":0,"val":"avatar","end":""}],
    types: placeholder as Registry['admin.admin.upload_user_avatar']['types'],
  },
  'admin.admin.delete_user': {
    methods: ["DELETE"],
    pattern: '/api/admin/users/:id',
    tokens: [{"old":"/api/admin/users/:id","type":0,"val":"api","end":""},{"old":"/api/admin/users/:id","type":0,"val":"admin","end":""},{"old":"/api/admin/users/:id","type":0,"val":"users","end":""},{"old":"/api/admin/users/:id","type":1,"val":"id","end":""}],
    types: placeholder as Registry['admin.admin.delete_user']['types'],
  },
  'admin.admin.profile': {
    methods: ["GET","HEAD"],
    pattern: '/api/admin/profile',
    tokens: [{"old":"/api/admin/profile","type":0,"val":"api","end":""},{"old":"/api/admin/profile","type":0,"val":"admin","end":""},{"old":"/api/admin/profile","type":0,"val":"profile","end":""}],
    types: placeholder as Registry['admin.admin.profile']['types'],
  },
  'admin.admin.update_profile': {
    methods: ["PUT"],
    pattern: '/api/admin/profile',
    tokens: [{"old":"/api/admin/profile","type":0,"val":"api","end":""},{"old":"/api/admin/profile","type":0,"val":"admin","end":""},{"old":"/api/admin/profile","type":0,"val":"profile","end":""}],
    types: placeholder as Registry['admin.admin.update_profile']['types'],
  },
  'admin.admin.upload_profile_avatar': {
    methods: ["POST"],
    pattern: '/api/admin/profile/avatar',
    tokens: [{"old":"/api/admin/profile/avatar","type":0,"val":"api","end":""},{"old":"/api/admin/profile/avatar","type":0,"val":"admin","end":""},{"old":"/api/admin/profile/avatar","type":0,"val":"profile","end":""},{"old":"/api/admin/profile/avatar","type":0,"val":"avatar","end":""}],
    types: placeholder as Registry['admin.admin.upload_profile_avatar']['types'],
  },
  'support.support.help': {
    methods: ["GET","HEAD"],
    pattern: '/api/support/help',
    tokens: [{"old":"/api/support/help","type":0,"val":"api","end":""},{"old":"/api/support/help","type":0,"val":"support","end":""},{"old":"/api/support/help","type":0,"val":"help","end":""}],
    types: placeholder as Registry['support.support.help']['types'],
  },
  'support.support.emergency': {
    methods: ["GET","HEAD"],
    pattern: '/api/support/emergency',
    tokens: [{"old":"/api/support/emergency","type":0,"val":"api","end":""},{"old":"/api/support/emergency","type":0,"val":"support","end":""},{"old":"/api/support/emergency","type":0,"val":"emergency","end":""}],
    types: placeholder as Registry['support.support.emergency']['types'],
  },
} as const satisfies Record<string, AdonisEndpoint>

export { routes }

export const registry = {
  routes,
  $tree: {} as ApiDefinition,
}

declare module '@tuyau/core/types' {
  export interface UserRegistry {
    routes: typeof routes
    $tree: ApiDefinition
  }
}
