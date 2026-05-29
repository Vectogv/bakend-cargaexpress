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
    'admin.admin.dashboard': { paramsTuple?: []; params?: {} }
    'admin.admin.users': { paramsTuple?: []; params?: {} }
    'admin.admin.drivers': { paramsTuple?: []; params?: {} }
    'admin.admin.trips': { paramsTuple?: []; params?: {} }
    'admin.admin.earnings': { paramsTuple?: []; params?: {} }
    'admin.admin.update_user': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.admin.toggle_suspend_user': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.admin.upload_user_avatar': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.admin.delete_user': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.admin.profile': { paramsTuple?: []; params?: {} }
    'admin.admin.update_profile': { paramsTuple?: []; params?: {} }
    'admin.admin.upload_profile_avatar': { paramsTuple?: []; params?: {} }
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
    'admin.admin.dashboard': { paramsTuple?: []; params?: {} }
    'admin.admin.users': { paramsTuple?: []; params?: {} }
    'admin.admin.drivers': { paramsTuple?: []; params?: {} }
    'admin.admin.trips': { paramsTuple?: []; params?: {} }
    'admin.admin.earnings': { paramsTuple?: []; params?: {} }
    'admin.admin.profile': { paramsTuple?: []; params?: {} }
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
    'admin.admin.dashboard': { paramsTuple?: []; params?: {} }
    'admin.admin.users': { paramsTuple?: []; params?: {} }
    'admin.admin.drivers': { paramsTuple?: []; params?: {} }
    'admin.admin.trips': { paramsTuple?: []; params?: {} }
    'admin.admin.earnings': { paramsTuple?: []; params?: {} }
    'admin.admin.profile': { paramsTuple?: []; params?: {} }
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
    'admin.admin.upload_profile_avatar': { paramsTuple?: []; params?: {} }
  }
  PUT: {
    'users.profile.update': { paramsTuple?: []; params?: {} }
    'drivers.driver.status': { paramsTuple?: []; params?: {} }
    'drivers.driver.location': { paramsTuple?: []; params?: {} }
    'notifications.notification.read': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.admin.update_user': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.admin.toggle_suspend_user': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.admin.upload_user_avatar': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.admin.update_profile': { paramsTuple?: []; params?: {} }
  }
  DELETE: {
    'admin.admin.delete_user': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
  }
}
declare module '@adonisjs/core/types/http' {
  export interface RoutesList extends ScannedRoutes {}
}