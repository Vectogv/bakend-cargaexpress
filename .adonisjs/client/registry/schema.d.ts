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
  'auth.auth.logout': {
    methods: ["POST"]
    pattern: '/api/auth/logout'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/auth_controller').default['logout']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/auth_controller').default['logout']>>>
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
  'users.profile.update_fcm_token': {
    methods: ["PUT"]
    pattern: '/api/users/fcm-token'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/profile_controller').default['updateFcmToken']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/profile_controller').default['updateFcmToken']>>>
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
  'drivers.driver.earnings_history': {
    methods: ["GET","HEAD"]
    pattern: '/api/drivers/earnings/history'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/driver_controller').default['earningsHistory']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/driver_controller').default['earningsHistory']>>>
    }
  }
  'drivers.driver.earnings_pdf': {
    methods: ["GET","HEAD"]
    pattern: '/api/drivers/earnings/pdf'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/driver_controller').default['earningsPDF']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/driver_controller').default['earningsPDF']>>>
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
  'drivers.driver.upload_cedula': {
    methods: ["POST"]
    pattern: '/api/drivers/verification/cedula'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/driver_controller').default['uploadCedula']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/driver_controller').default['uploadCedula']>>>
    }
  }
  'drivers.driver.upload_licencia': {
    methods: ["POST"]
    pattern: '/api/drivers/verification/licencia'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/driver_controller').default['uploadLicencia']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/driver_controller').default['uploadLicencia']>>>
    }
  }
  'drivers.driver.upload_vehiculo': {
    methods: ["POST"]
    pattern: '/api/drivers/verification/vehiculo'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/driver_controller').default['uploadVehiculo']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/driver_controller').default['uploadVehiculo']>>>
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
  'trips.trip.request_cancellation': {
    methods: ["POST"]
    pattern: '/api/trips/:id/request-cancellation'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/trip_controller').default['requestCancellation']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/trip_controller').default['requestCancellation']>>>
    }
  }
  'trips.trip.rate': {
    methods: ["POST"]
    pattern: '/api/trips/:id/rate'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/trip_controller').default['rate']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/trip_controller').default['rate']>>>
    }
  }
  'trips.trip.delivery_photo': {
    methods: ["POST"]
    pattern: '/api/trips/:id/delivery-photo'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/trip_controller').default['deliveryPhoto']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/trip_controller').default['deliveryPhoto']>>>
    }
  }
  'trips.chat.index': {
    methods: ["GET","HEAD"]
    pattern: '/api/trips/:id/chat'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/chat_controller').default['index']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/chat_controller').default['index']>>>
    }
  }
  'trips.chat.store': {
    methods: ["POST"]
    pattern: '/api/trips/:id/chat'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/chat_controller').default['store']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/chat_controller').default['store']>>>
    }
  }
  'trips.dispute.store': {
    methods: ["POST"]
    pattern: '/api/trips/:id/dispute'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/dispute_controller').default['store']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/dispute_controller').default['store']>>>
    }
  }
  'trips.dispute.appeal': {
    methods: ["POST"]
    pattern: '/api/trips/:id/dispute/appeal'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/dispute_controller').default['appeal']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/dispute_controller').default['appeal']>>>
    }
  }
  'trips.dispute.upload_support': {
    methods: ["POST"]
    pattern: '/api/trips/:id/dispute/support'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/dispute_controller').default['uploadSupport']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/dispute_controller').default['uploadSupport']>>>
    }
  }
  'trips.offer.index': {
    methods: ["GET","HEAD"]
    pattern: '/api/trips/:id/offers'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/offer_controller').default['index']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/offer_controller').default['index']>>>
    }
  }
  'trips.offer.store': {
    methods: ["POST"]
    pattern: '/api/trips/:id/offers'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/offer_controller').default['store']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/offer_controller').default['store']>>>
    }
  }
  'trips.offer.accept': {
    methods: ["POST"]
    pattern: '/api/trips/:id/offers/:offerId/accept'
    types: {
      body: {}
      paramsTuple: [ParamValue, ParamValue]
      params: { id: ParamValue; offerId: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/offer_controller').default['accept']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/offer_controller').default['accept']>>>
    }
  }
  'trips.offer.reject': {
    methods: ["POST"]
    pattern: '/api/trips/:id/offers/:offerId/reject'
    types: {
      body: {}
      paramsTuple: [ParamValue, ParamValue]
      params: { id: ParamValue; offerId: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/offer_controller').default['reject']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/offer_controller').default['reject']>>>
    }
  }
  'trips.report.store': {
    methods: ["POST"]
    pattern: '/api/trips/:id/report'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/report_controller').default['store']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/report_controller').default['store']>>>
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
  'admin.admin.emergencies': {
    methods: ["GET","HEAD"]
    pattern: '/api/admin/emergencies'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin_controller').default['emergencies']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin_controller').default['emergencies']>>>
    }
  }
  'admin.admin.resolve_emergency': {
    methods: ["PUT"]
    pattern: '/api/admin/emergencies/:id/resolve'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin_controller').default['resolveEmergency']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin_controller').default['resolveEmergency']>>>
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
  'admin.admin.conductor_debt': {
    methods: ["GET","HEAD"]
    pattern: '/api/admin/commissions'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin_controller').default['conductorDebt']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin_controller').default['conductorDebt']>>>
    }
  }
  'admin.admin.mark_commission_paid': {
    methods: ["PUT"]
    pattern: '/api/admin/commissions/:conductorId/paid'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { conductorId: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin_controller').default['markCommissionPaid']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin_controller').default['markCommissionPaid']>>>
    }
  }
  'admin.admin.commission_history': {
    methods: ["GET","HEAD"]
    pattern: '/api/admin/commissions/:conductorId/history'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { conductorId: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin_controller').default['commissionHistory']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin_controller').default['commissionHistory']>>>
    }
  }
  'admin.admin.reports': {
    methods: ["GET","HEAD"]
    pattern: '/api/admin/reports'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin_controller').default['reports']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin_controller').default['reports']>>>
    }
  }
  'admin.admin.resolve_report': {
    methods: ["PUT"]
    pattern: '/api/admin/reports/:id/resolve'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin_controller').default['resolveReport']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin_controller').default['resolveReport']>>>
    }
  }
  'admin.admin.disputes': {
    methods: ["GET","HEAD"]
    pattern: '/api/admin/disputes'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin_controller').default['disputes']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin_controller').default['disputes']>>>
    }
  }
  'admin.admin.resolve_dispute': {
    methods: ["PUT"]
    pattern: '/api/admin/disputes/:id/resolve'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin_controller').default['resolveDispute']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin_controller').default['resolveDispute']>>>
    }
  }
  'admin.admin.clear_debt': {
    methods: ["PUT"]
    pattern: '/api/admin/users/:id/clear-debt'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin_controller').default['clearDebt']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin_controller').default['clearDebt']>>>
    }
  }
  'admin.admin.pending_verifications': {
    methods: ["GET","HEAD"]
    pattern: '/api/admin/verifications'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin_controller').default['pendingVerifications']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin_controller').default['pendingVerifications']>>>
    }
  }
  'admin.admin.approve_driver': {
    methods: ["PUT"]
    pattern: '/api/admin/verifications/:conductorId/approve'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { conductorId: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin_controller').default['approveDriver']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin_controller').default['approveDriver']>>>
    }
  }
  'admin.admin.reject_driver': {
    methods: ["PUT"]
    pattern: '/api/admin/verifications/:conductorId/reject'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { conductorId: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin_controller').default['rejectDriver']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin_controller').default['rejectDriver']>>>
    }
  }
  'admin.admin.pending_payments': {
    methods: ["GET","HEAD"]
    pattern: '/api/admin/payments/pending'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin_controller').default['pendingPayments']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin_controller').default['pendingPayments']>>>
    }
  }
  'admin.admin.confirm_payment': {
    methods: ["PUT"]
    pattern: '/api/admin/payments/:userId/confirm'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { userId: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin_controller').default['confirmPayment']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin_controller').default['confirmPayment']>>>
    }
  }
  'admin.admin.reject_payment': {
    methods: ["PUT"]
    pattern: '/api/admin/payments/:userId/reject'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { userId: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin_controller').default['rejectPayment']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin_controller').default['rejectPayment']>>>
    }
  }
  'admin.admin.update_config': {
    methods: ["PUT"]
    pattern: '/api/admin/config'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin_controller').default['updateConfig']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin_controller').default['updateConfig']>>>
    }
  }
  'admin.admin.update_coverage': {
    methods: ["PUT"]
    pattern: '/api/admin/config/coverage'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin_controller').default['updateCoverage']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin_controller').default['updateCoverage']>>>
    }
  }
  'admin.admin.update_banner': {
    methods: ["PUT"]
    pattern: '/api/admin/config/banner'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin_controller').default['updateBanner']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin_controller').default['updateBanner']>>>
    }
  }
  'admin.admin.assign_moderator': {
    methods: ["PUT"]
    pattern: '/api/admin/users/:id/moderator'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin_controller').default['assignModerator']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin_controller').default['assignModerator']>>>
    }
  }
  'admin.admin.assign_leader': {
    methods: ["PUT"]
    pattern: '/api/admin/users/:id/leader'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin_controller').default['assignLeader']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin_controller').default['assignLeader']>>>
    }
  }
  'admin.admin.approve_comunicado': {
    methods: ["PUT"]
    pattern: '/api/admin/comunicados/:id/approve'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin_controller').default['approveComunicado']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin_controller').default['approveComunicado']>>>
    }
  }
  'admin.admin.reject_comunicado': {
    methods: ["PUT"]
    pattern: '/api/admin/comunicados/:id/reject'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin_controller').default['rejectComunicado']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin_controller').default['rejectComunicado']>>>
    }
  }
  'admin.admin.approve_encuesta': {
    methods: ["PUT"]
    pattern: '/api/admin/encuestas/:id/approve'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin_controller').default['approveEncuesta']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin_controller').default['approveEncuesta']>>>
    }
  }
  'admin.admin.moderator_reports': {
    methods: ["GET","HEAD"]
    pattern: '/api/admin/moderator-reports'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin_controller').default['moderatorReports']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin_controller').default['moderatorReports']>>>
    }
  }
  'admin.admin.backup_logs': {
    methods: ["GET","HEAD"]
    pattern: '/api/admin/backups'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin_controller').default['backupLogs']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin_controller').default['backupLogs']>>>
    }
  }
  'admin.admin.manual_backup': {
    methods: ["POST"]
    pattern: '/api/admin/backups/run'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin_controller').default['manualBackup']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin_controller').default['manualBackup']>>>
    }
  }
  'admin.admin.cancellation_requests': {
    methods: ["GET","HEAD"]
    pattern: '/api/admin/cancellation-requests'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin_controller').default['cancellationRequests']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin_controller').default['cancellationRequests']>>>
    }
  }
  'admin.admin.approve_cancellation': {
    methods: ["POST"]
    pattern: '/api/admin/cancellation-requests/:id/approve'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin_controller').default['approveCancellation']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin_controller').default['approveCancellation']>>>
    }
  }
  'admin.admin.reject_cancellation': {
    methods: ["POST"]
    pattern: '/api/admin/cancellation-requests/:id/reject'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin_controller').default['rejectCancellation']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin_controller').default['rejectCancellation']>>>
    }
  }
  'favorites.favorite_route.index': {
    methods: ["GET","HEAD"]
    pattern: '/api/favorites'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/favorite_route_controller').default['index']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/favorite_route_controller').default['index']>>>
    }
  }
  'favorites.favorite_route.store': {
    methods: ["POST"]
    pattern: '/api/favorites'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/favorite_route_controller').default['store']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/favorite_route_controller').default['store']>>>
    }
  }
  'favorites.favorite_route.destroy': {
    methods: ["DELETE"]
    pattern: '/api/favorites/:id'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/favorite_route_controller').default['destroy']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/favorite_route_controller').default['destroy']>>>
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
  'disputes.dispute.store_root': {
    methods: ["POST"]
    pattern: '/api/disputes'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/dispute_controller').default['storeRoot']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/dispute_controller').default['storeRoot']>>>
    }
  }
  'disputes.dispute.show': {
    methods: ["GET","HEAD"]
    pattern: '/api/disputes/:id'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/dispute_controller').default['show']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/dispute_controller').default['show']>>>
    }
  }
  'payment.payment.info': {
    methods: ["GET","HEAD"]
    pattern: '/api/payment/debt'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/payment_controller').default['info']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/payment_controller').default['info']>>>
    }
  }
  'payment.payment.upload_proof': {
    methods: ["POST"]
    pattern: '/api/payment/proof'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/payment_controller').default['uploadProof']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/payment_controller').default['uploadProof']>>>
    }
  }
  'payments.info': {
    methods: ["GET","HEAD"]
    pattern: '/api/payments'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/payment_controller').default['info']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/payment_controller').default['info']>>>
    }
  }
  'settings.settings.show': {
    methods: ["GET","HEAD"]
    pattern: '/api/settings'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/settings_controller').default['show']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/settings_controller').default['show']>>>
    }
  }
  'settings.settings.update': {
    methods: ["PUT"]
    pattern: '/api/settings'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/settings').updateSettingsValidator)>>
      paramsTuple: []
      params: {}
      query: ExtractQuery<InferInput<(typeof import('#validators/settings').updateSettingsValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/settings_controller').default['update']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/settings_controller').default['update']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'mapbox.token': {
    methods: ["GET","HEAD"]
    pattern: '/api/config/mapbox'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/mapbox_controller').default['token']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/mapbox_controller').default['token']>>>
    }
  }
  'moderator.moderator.store_comunicado': {
    methods: ["POST"]
    pattern: '/api/moderator/comunicados'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/moderator_controller').default['storeComunicado']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/moderator_controller').default['storeComunicado']>>>
    }
  }
  'moderator.moderator.my_comunicados': {
    methods: ["GET","HEAD"]
    pattern: '/api/moderator/comunicados'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/moderator_controller').default['myComunicados']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/moderator_controller').default['myComunicados']>>>
    }
  }
  'moderator.moderator.drivers_list': {
    methods: ["GET","HEAD"]
    pattern: '/api/moderator/drivers'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/moderator_controller').default['driversList']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/moderator_controller').default['driversList']>>>
    }
  }
  'moderator.moderator.inactive_drivers': {
    methods: ["GET","HEAD"]
    pattern: '/api/moderator/drivers/inactive'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/moderator_controller').default['inactiveDrivers']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/moderator_controller').default['inactiveDrivers']>>>
    }
  }
  'moderator.moderator.notify_driver': {
    methods: ["POST"]
    pattern: '/api/moderator/drivers/:id/notify'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/moderator_controller').default['notifyDriver']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/moderator_controller').default['notifyDriver']>>>
    }
  }
  'moderator.moderator.report_driver': {
    methods: ["POST"]
    pattern: '/api/moderator/drivers/:id/report'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/moderator_controller').default['reportDriver']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/moderator_controller').default['reportDriver']>>>
    }
  }
  'moderator.moderator.store_encuesta': {
    methods: ["POST"]
    pattern: '/api/moderator/encuestas'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/moderator_controller').default['storeEncuesta']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/moderator_controller').default['storeEncuesta']>>>
    }
  }
  'moderator.moderator.encuesta_results': {
    methods: ["GET","HEAD"]
    pattern: '/api/moderator/encuestas/:id/results'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/moderator_controller').default['encuestaResults']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/moderator_controller').default['encuestaResults']>>>
    }
  }
  'moderator.moderator.answer_encuesta': {
    methods: ["POST"]
    pattern: '/api/moderator/encuestas/:id/answer'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/moderator_controller').default['answerEncuesta']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/moderator_controller').default['answerEncuesta']>>>
    }
  }
  'avisos.moderator.avisos_index': {
    methods: ["GET","HEAD"]
    pattern: '/api/avisos'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/moderator_controller').default['avisosIndex']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/moderator_controller').default['avisosIndex']>>>
    }
  }
  'avisos.moderator.avisos_store': {
    methods: ["POST"]
    pattern: '/api/avisos'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/moderator_controller').default['avisosStore']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/moderator_controller').default['avisosStore']>>>
    }
  }
  'avisos.moderator.avisos_pin': {
    methods: ["PUT"]
    pattern: '/api/avisos/:id/pin'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/moderator_controller').default['avisosPin']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/moderator_controller').default['avisosPin']>>>
    }
  }
  'avisos.moderator.avisos_delete': {
    methods: ["DELETE"]
    pattern: '/api/avisos/:id'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/moderator_controller').default['avisosDelete']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/moderator_controller').default['avisosDelete']>>>
    }
  }
  'emergency.trigger': {
    methods: ["POST"]
    pattern: '/api/emergency'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/emergency_controller').default['trigger']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/emergency_controller').default['trigger']>>>
    }
  }
  'leader.leader.avisos_index': {
    methods: ["GET","HEAD"]
    pattern: '/api/leader/avisos'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/leader_controller').default['avisosIndex']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/leader_controller').default['avisosIndex']>>>
    }
  }
  'leader.leader.avisos_store': {
    methods: ["POST"]
    pattern: '/api/leader/avisos'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/leader_controller').default['avisosStore']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/leader_controller').default['avisosStore']>>>
    }
  }
  'leader.leader.avisos_pin': {
    methods: ["PUT"]
    pattern: '/api/leader/avisos/:id/pin'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/leader_controller').default['avisosPin']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/leader_controller').default['avisosPin']>>>
    }
  }
  'leader.leader.avisos_delete': {
    methods: ["DELETE"]
    pattern: '/api/leader/avisos/:id'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/leader_controller').default['avisosDelete']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/leader_controller').default['avisosDelete']>>>
    }
  }
  'leader.leader.store_comunicado': {
    methods: ["POST"]
    pattern: '/api/leader/comunicados'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/leader_controller').default['storeComunicado']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/leader_controller').default['storeComunicado']>>>
    }
  }
  'leader.leader.my_comunicados': {
    methods: ["GET","HEAD"]
    pattern: '/api/leader/comunicados'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/leader_controller').default['myComunicados']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/leader_controller').default['myComunicados']>>>
    }
  }
  'leader.leader.drivers_list': {
    methods: ["GET","HEAD"]
    pattern: '/api/leader/drivers'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/leader_controller').default['driversList']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/leader_controller').default['driversList']>>>
    }
  }
  'leader.leader.reports_limited': {
    methods: ["GET","HEAD"]
    pattern: '/api/leader/reports'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/leader_controller').default['reportsLimited']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/leader_controller').default['reportsLimited']>>>
    }
  }
}
