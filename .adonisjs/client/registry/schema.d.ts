/* eslint-disable prettier/prettier */
/// <reference path="../manifest.d.ts" />

import type { ExtractBody, ExtractErrorResponse, ExtractQuery, ExtractQueryForGet, ExtractResponse } from '@tuyau/core/types'
import type { InferInput, SimpleError } from '@vinejs/vine/types'

export type ParamValue = string | number | bigint | boolean

export interface Registry {
  'auth.auth.register': {
    methods: ["POST"]
    pattern: '/api/auth/register'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/auth').registerValidator)>>
      paramsTuple: []
      params: {}
      query: ExtractQuery<InferInput<(typeof import('#validators/auth').registerValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/auth_controller').default['register']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/auth_controller').default['register']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'auth.auth.login': {
    methods: ["POST"]
    pattern: '/api/auth/login'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/auth').loginValidator)>>
      paramsTuple: []
      params: {}
      query: ExtractQuery<InferInput<(typeof import('#validators/auth').loginValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/auth_controller').default['login']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/auth_controller').default['login']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'auth.auth.refresh_token': {
    methods: ["POST"]
    pattern: '/api/auth/refresh-token'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/auth').refreshTokenValidator)>>
      paramsTuple: []
      params: {}
      query: ExtractQuery<InferInput<(typeof import('#validators/auth').refreshTokenValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/auth_controller').default['refreshToken']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/auth_controller').default['refreshToken']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'users.profile.show': {
    methods: ["GET","HEAD"]
    pattern: '/api/users/profile'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/profile_controller').default['show']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/profile_controller').default['show']>>>
    }
  }
  'users.profile.update': {
    methods: ["PUT"]
    pattern: '/api/users/profile'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/profile').updateProfileValidator)>>
      paramsTuple: []
      params: {}
      query: ExtractQuery<InferInput<(typeof import('#validators/profile').updateProfileValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/profile_controller').default['update']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/profile_controller').default['update']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'users.profile.avatar': {
    methods: ["POST"]
    pattern: '/api/users/avatar'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/profile_controller').default['avatar']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/profile_controller').default['avatar']>>>
    }
  }
  'drivers.driver.status': {
    methods: ["PUT"]
    pattern: '/api/drivers/status'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/driver').driverStatusValidator)>>
      paramsTuple: []
      params: {}
      query: ExtractQuery<InferInput<(typeof import('#validators/driver').driverStatusValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/driver_controller').default['status']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/driver_controller').default['status']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'drivers.driver.earnings': {
    methods: ["GET","HEAD"]
    pattern: '/api/drivers/earnings'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/driver_controller').default['earnings']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/driver_controller').default['earnings']>>>
    }
  }
  'drivers.driver.stats': {
    methods: ["GET","HEAD"]
    pattern: '/api/drivers/stats'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/driver_controller').default['stats']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/driver_controller').default['stats']>>>
    }
  }
  'drivers.driver.today_stats': {
    methods: ["GET","HEAD"]
    pattern: '/api/drivers/today-stats'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/driver_controller').default['todayStats']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/driver_controller').default['todayStats']>>>
    }
  }
  'drivers.driver.vehicle_photo': {
    methods: ["POST"]
    pattern: '/api/drivers/vehicle-photo'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/driver_controller').default['vehiclePhoto']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/driver_controller').default['vehiclePhoto']>>>
    }
  }
  'drivers.driver.location': {
    methods: ["PUT"]
    pattern: '/api/drivers/location'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/driver').driverLocationValidator)>>
      paramsTuple: []
      params: {}
      query: ExtractQuery<InferInput<(typeof import('#validators/driver').driverLocationValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/driver_controller').default['location']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/driver_controller').default['location']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'drivers.driver.driver_photo': {
    methods: ["POST"]
    pattern: '/api/drivers/driver-photo'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/driver_controller').default['driverPhoto']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/driver_controller').default['driverPhoto']>>>
    }
  }
  'trips.trip.request': {
    methods: ["POST"]
    pattern: '/api/trips/request'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/trip').tripRequestValidator)>>
      paramsTuple: []
      params: {}
      query: ExtractQuery<InferInput<(typeof import('#validators/trip').tripRequestValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/trip_controller').default['request']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/trip_controller').default['request']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'trips.trip.nearby': {
    methods: ["GET","HEAD"]
    pattern: '/api/trips/nearby'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/trip_controller').default['nearby']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/trip_controller').default['nearby']>>>
    }
  }
  'trips.trip.active': {
    methods: ["GET","HEAD"]
    pattern: '/api/trips/active'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/trip_controller').default['active']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/trip_controller').default['active']>>>
    }
  }
  'trips.trip.history': {
    methods: ["GET","HEAD"]
    pattern: '/api/trips/history'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/trip_controller').default['history']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/trip_controller').default['history']>>>
    }
  }
  'trips.trip.show': {
    methods: ["GET","HEAD"]
    pattern: '/api/trips/:id'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/trip_controller').default['show']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/trip_controller').default['show']>>>
    }
  }
  'trips.trip.accept': {
    methods: ["POST"]
    pattern: '/api/trips/:id/accept'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/trip_controller').default['accept']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/trip_controller').default['accept']>>>
    }
  }
  'trips.trip.decline': {
    methods: ["POST"]
    pattern: '/api/trips/:id/decline'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/trip_controller').default['decline']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/trip_controller').default['decline']>>>
    }
  }
  'trips.trip.start_trip': {
    methods: ["POST"]
    pattern: '/api/trips/:id/start-trip'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/trip_controller').default['startTrip']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/trip_controller').default['startTrip']>>>
    }
  }
  'trips.trip.complete': {
    methods: ["POST"]
    pattern: '/api/trips/:id/complete'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/trip').tripCompleteValidator)>>
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/trip').tripCompleteValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/trip_controller').default['complete']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/trip_controller').default['complete']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'trips.trip.finalize': {
    methods: ["POST"]
    pattern: '/api/trips/:id/finalize'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/trip').tripCompleteValidator)>>
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/trip').tripCompleteValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/trip_controller').default['finalize']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/trip_controller').default['finalize']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'trips.trip.cancel': {
    methods: ["POST"]
    pattern: '/api/trips/:id/cancel'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/trip').tripCancelValidator)>>
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/trip').tripCancelValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/trip_controller').default['cancel']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/trip_controller').default['cancel']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'notifications.notification.index': {
    methods: ["GET","HEAD"]
    pattern: '/api/notifications'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/notification_controller').default['index']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/notification_controller').default['index']>>>
    }
  }
  'notifications.notification.read': {
    methods: ["PUT"]
    pattern: '/api/notifications/:id/read'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/notification_controller').default['read']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/notification_controller').default['read']>>>
    }
  }
  'admin.admin.dashboard': {
    methods: ["GET","HEAD"]
    pattern: '/api/admin/dashboard'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin_controller').default['dashboard']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin_controller').default['dashboard']>>>
    }
  }
  'admin.admin.users': {
    methods: ["GET","HEAD"]
    pattern: '/api/admin/users'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin_controller').default['users']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin_controller').default['users']>>>
    }
  }
  'admin.admin.drivers': {
    methods: ["GET","HEAD"]
    pattern: '/api/admin/drivers'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin_controller').default['drivers']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin_controller').default['drivers']>>>
    }
  }
  'admin.admin.trips': {
    methods: ["GET","HEAD"]
    pattern: '/api/admin/trips'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin_controller').default['trips']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin_controller').default['trips']>>>
    }
  }
  'admin.admin.earnings': {
    methods: ["GET","HEAD"]
    pattern: '/api/admin/earnings'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin_controller').default['earnings']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin_controller').default['earnings']>>>
    }
  }
  'admin.admin.update_user': {
    methods: ["PUT"]
    pattern: '/api/admin/users/:id'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin_controller').default['updateUser']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin_controller').default['updateUser']>>>
    }
  }
  'admin.admin.toggle_suspend_user': {
    methods: ["PUT"]
    pattern: '/api/admin/users/:id/suspend'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin_controller').default['toggleSuspendUser']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin_controller').default['toggleSuspendUser']>>>
    }
  }
  'admin.admin.upload_user_avatar': {
    methods: ["PUT"]
    pattern: '/api/admin/users/:id/avatar'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin_controller').default['uploadUserAvatar']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin_controller').default['uploadUserAvatar']>>>
    }
  }
  'admin.admin.delete_user': {
    methods: ["DELETE"]
    pattern: '/api/admin/users/:id'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin_controller').default['deleteUser']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin_controller').default['deleteUser']>>>
    }
  }
  'admin.admin.profile': {
    methods: ["GET","HEAD"]
    pattern: '/api/admin/profile'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin_controller').default['profile']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin_controller').default['profile']>>>
    }
  }
  'admin.admin.update_profile': {
    methods: ["PUT"]
    pattern: '/api/admin/profile'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin_controller').default['updateProfile']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin_controller').default['updateProfile']>>>
    }
  }
  'admin.admin.upload_profile_avatar': {
    methods: ["POST"]
    pattern: '/api/admin/profile/avatar'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin_controller').default['uploadProfileAvatar']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin_controller').default['uploadProfileAvatar']>>>
    }
  }
  'support.support.help': {
    methods: ["GET","HEAD"]
    pattern: '/api/support/help'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/support_controller').default['help']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/support_controller').default['help']>>>
    }
  }
  'support.support.emergency': {
    methods: ["GET","HEAD"]
    pattern: '/api/support/emergency'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/support_controller').default['emergency']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/support_controller').default['emergency']>>>
    }
  }
}
