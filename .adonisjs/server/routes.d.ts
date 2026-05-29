import '@adonisjs/core/types/http'

type ParamValue = string | number | bigint | boolean

export type ScannedRoutes = {
  ALL: {
    'auth.auth.register': { paramsTuple?: []; params?: {} }
    'auth.auth.login': { paramsTuple?: []; params?: {} }
    'auth.auth.refresh_token': { paramsTuple?: []; params?: {} }
    'users.profile.show': { paramsTuple?: []; params?: {} }
    'users.profile.update': { paramsTuple?: []; params?: {} }
    'users.profile.avatar': { paramsTuple?: []; params?: {} }
    'drivers.driver.status': { paramsTuple?: []; params?: {} }
    'drivers.driver.earnings': { paramsTuple?: []; params?: {} }
    'drivers.driver.stats': { paramsTuple?: []; params?: {} }
    'drivers.driver.today_stats': { paramsTuple?: []; params?: {} }
    'drivers.driver.vehicle_photo': { paramsTuple?: []; params?: {} }
    'drivers.driver.location': { paramsTuple?: []; params?: {} }
    'drivers.driver.driver_photo': { paramsTuple?: []; params?: {} }
    'trips.trip.request': { paramsTuple?: []; params?: {} }
    'trips.trip.nearby': { paramsTuple?: []; params?: {} }
    'trips.trip.active': { paramsTuple?: []; params?: {} }
    'trips.trip.history': { paramsTuple?: []; params?: {} }
    'trips.trip.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'trips.trip.accept': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'trips.trip.decline': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'trips.trip.start_trip': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'trips.trip.complete': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'trips.trip.finalize': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'trips.trip.cancel': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'notifications.notification.index': { paramsTuple?: []; params?: {} }
    'notifications.notification.read': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'support.support.help': { paramsTuple?: []; params?: {} }
    'support.support.emergency': { paramsTuple?: []; params?: {} }
  }
  GET: {
    'users.profile.show': { paramsTuple?: []; params?: {} }
    'drivers.driver.earnings': { paramsTuple?: []; params?: {} }
    'drivers.driver.stats': { paramsTuple?: []; params?: {} }
    'drivers.driver.today_stats': { paramsTuple?: []; params?: {} }
    'trips.trip.nearby': { paramsTuple?: []; params?: {} }
    'trips.trip.active': { paramsTuple?: []; params?: {} }
    'trips.trip.history': { paramsTuple?: []; params?: {} }
    'trips.trip.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'notifications.notification.index': { paramsTuple?: []; params?: {} }
    'support.support.help': { paramsTuple?: []; params?: {} }
    'support.support.emergency': { paramsTuple?: []; params?: {} }
  }
  HEAD: {
    'users.profile.show': { paramsTuple?: []; params?: {} }
    'drivers.driver.earnings': { paramsTuple?: []; params?: {} }
    'drivers.driver.stats': { paramsTuple?: []; params?: {} }
    'drivers.driver.today_stats': { paramsTuple?: []; params?: {} }
    'trips.trip.nearby': { paramsTuple?: []; params?: {} }
    'trips.trip.active': { paramsTuple?: []; params?: {} }
    'trips.trip.history': { paramsTuple?: []; params?: {} }
    'trips.trip.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'notifications.notification.index': { paramsTuple?: []; params?: {} }
    'support.support.help': { paramsTuple?: []; params?: {} }
    'support.support.emergency': { paramsTuple?: []; params?: {} }
  }
  POST: {
    'auth.auth.register': { paramsTuple?: []; params?: {} }
    'auth.auth.login': { paramsTuple?: []; params?: {} }
    'auth.auth.refresh_token': { paramsTuple?: []; params?: {} }
    'users.profile.avatar': { paramsTuple?: []; params?: {} }
    'drivers.driver.vehicle_photo': { paramsTuple?: []; params?: {} }
    'drivers.driver.driver_photo': { paramsTuple?: []; params?: {} }
    'trips.trip.request': { paramsTuple?: []; params?: {} }
    'trips.trip.accept': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'trips.trip.decline': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'trips.trip.start_trip': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'trips.trip.complete': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'trips.trip.finalize': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'trips.trip.cancel': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
  }
  PUT: {
    'users.profile.update': { paramsTuple?: []; params?: {} }
    'drivers.driver.status': { paramsTuple?: []; params?: {} }
    'drivers.driver.location': { paramsTuple?: []; params?: {} }
    'notifications.notification.read': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
  }
}
declare module '@adonisjs/core/types/http' {
  export interface RoutesList extends ScannedRoutes {}
}