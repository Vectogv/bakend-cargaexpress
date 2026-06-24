import '@adonisjs/core/types/http'

type ParamValue = string | number | bigint | boolean

export type ScannedRoutes = {
  ALL: {
    'auth.auth.register': { paramsTuple?: []; params?: {} }
    'auth.auth.login': { paramsTuple?: []; params?: {} }
    'auth.auth.refresh_token': { paramsTuple?: []; params?: {} }
    'auth.auth.logout': { paramsTuple?: []; params?: {} }
    'users.profile.show': { paramsTuple?: []; params?: {} }
    'users.profile.update': { paramsTuple?: []; params?: {} }
    'users.profile.avatar': { paramsTuple?: []; params?: {} }
    'users.profile.update_fcm_token': { paramsTuple?: []; params?: {} }
    'drivers.driver.status': { paramsTuple?: []; params?: {} }
    'drivers.driver.earnings': { paramsTuple?: []; params?: {} }
    'drivers.driver.stats': { paramsTuple?: []; params?: {} }
    'drivers.driver.today_stats': { paramsTuple?: []; params?: {} }
    'drivers.driver.earnings_history': { paramsTuple?: []; params?: {} }
    'drivers.driver.earnings_pdf': { paramsTuple?: []; params?: {} }
    'drivers.driver.vehicle_photo': { paramsTuple?: []; params?: {} }
    'drivers.driver.location': { paramsTuple?: []; params?: {} }
    'drivers.driver.driver_photo': { paramsTuple?: []; params?: {} }
    'drivers.driver.upload_cedula': { paramsTuple?: []; params?: {} }
    'drivers.driver.upload_licencia': { paramsTuple?: []; params?: {} }
    'drivers.driver.upload_vehiculo': { paramsTuple?: []; params?: {} }
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
    'trips.trip.request_cancellation': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'trips.trip.rate': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'trips.trip.delivery_photo': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'trips.chat.index': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'trips.chat.store': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'trips.dispute.store': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'trips.dispute.appeal': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'trips.dispute.upload_support': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'trips.offer.index': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'trips.offer.store': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'trips.offer.accept': { paramsTuple: [ParamValue,ParamValue]; params: {'id': ParamValue,'offerId': ParamValue} }
    'trips.offer.reject': { paramsTuple: [ParamValue,ParamValue]; params: {'id': ParamValue,'offerId': ParamValue} }
    'trips.report.store': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
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
    'admin.admin.emergencies': { paramsTuple?: []; params?: {} }
    'admin.admin.resolve_emergency': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.admin.update_profile': { paramsTuple?: []; params?: {} }
    'admin.admin.upload_profile_avatar': { paramsTuple?: []; params?: {} }
    'admin.admin.conductor_debt': { paramsTuple?: []; params?: {} }
    'admin.admin.mark_commission_paid': { paramsTuple: [ParamValue]; params: {'conductorId': ParamValue} }
    'admin.admin.commission_history': { paramsTuple: [ParamValue]; params: {'conductorId': ParamValue} }
    'admin.admin.reports': { paramsTuple?: []; params?: {} }
    'admin.admin.resolve_report': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.admin.disputes': { paramsTuple?: []; params?: {} }
    'admin.admin.resolve_dispute': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.admin.clear_debt': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.admin.pending_verifications': { paramsTuple?: []; params?: {} }
    'admin.admin.approve_driver': { paramsTuple: [ParamValue]; params: {'conductorId': ParamValue} }
    'admin.admin.reject_driver': { paramsTuple: [ParamValue]; params: {'conductorId': ParamValue} }
    'admin.admin.pending_payments': { paramsTuple?: []; params?: {} }
    'admin.admin.confirm_payment': { paramsTuple: [ParamValue]; params: {'userId': ParamValue} }
    'admin.admin.reject_payment': { paramsTuple: [ParamValue]; params: {'userId': ParamValue} }
    'admin.admin.update_config': { paramsTuple?: []; params?: {} }
    'admin.admin.update_coverage': { paramsTuple?: []; params?: {} }
    'admin.admin.update_banner': { paramsTuple?: []; params?: {} }
    'admin.admin.assign_moderator': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.admin.assign_leader': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.admin.approve_comunicado': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.admin.reject_comunicado': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.admin.approve_encuesta': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.admin.moderator_reports': { paramsTuple?: []; params?: {} }
    'admin.admin.backup_logs': { paramsTuple?: []; params?: {} }
    'admin.admin.manual_backup': { paramsTuple?: []; params?: {} }
    'admin.admin.cancellation_requests': { paramsTuple?: []; params?: {} }
    'admin.admin.approve_cancellation': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.admin.reject_cancellation': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'favorites.favorite_route.index': { paramsTuple?: []; params?: {} }
    'favorites.favorite_route.store': { paramsTuple?: []; params?: {} }
    'favorites.favorite_route.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'support.support.help': { paramsTuple?: []; params?: {} }
    'support.support.emergency': { paramsTuple?: []; params?: {} }
    'disputes.dispute.store_root': { paramsTuple?: []; params?: {} }
    'disputes.dispute.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'disputes.dispute.submit_version': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'payment.payment.info': { paramsTuple?: []; params?: {} }
    'payment.payment.upload_proof': { paramsTuple?: []; params?: {} }
    'payments.info': { paramsTuple?: []; params?: {} }
    'settings.settings.show': { paramsTuple?: []; params?: {} }
    'settings.settings.update': { paramsTuple?: []; params?: {} }
    'mapbox.token': { paramsTuple?: []; params?: {} }
    'moderator.moderator.store_comunicado': { paramsTuple?: []; params?: {} }
    'moderator.moderator.my_comunicados': { paramsTuple?: []; params?: {} }
    'moderator.moderator.drivers_list': { paramsTuple?: []; params?: {} }
    'moderator.moderator.inactive_drivers': { paramsTuple?: []; params?: {} }
    'moderator.moderator.notify_driver': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'moderator.moderator.report_driver': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'moderator.moderator.store_encuesta': { paramsTuple?: []; params?: {} }
    'moderator.moderator.encuesta_results': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'moderator.moderator.answer_encuesta': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'avisos.moderator.avisos_index': { paramsTuple?: []; params?: {} }
    'avisos.moderator.avisos_store': { paramsTuple?: []; params?: {} }
    'avisos.moderator.avisos_pin': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'avisos.moderator.avisos_delete': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'emergency.trigger': { paramsTuple?: []; params?: {} }
    'leader.leader.avisos_index': { paramsTuple?: []; params?: {} }
    'leader.leader.avisos_store': { paramsTuple?: []; params?: {} }
    'leader.leader.avisos_pin': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'leader.leader.avisos_delete': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'leader.leader.store_comunicado': { paramsTuple?: []; params?: {} }
    'leader.leader.my_comunicados': { paramsTuple?: []; params?: {} }
    'leader.leader.drivers_list': { paramsTuple?: []; params?: {} }
    'leader.leader.reports_limited': { paramsTuple?: []; params?: {} }
  }
  GET: {
    'users.profile.show': { paramsTuple?: []; params?: {} }
    'drivers.driver.earnings': { paramsTuple?: []; params?: {} }
    'drivers.driver.stats': { paramsTuple?: []; params?: {} }
    'drivers.driver.today_stats': { paramsTuple?: []; params?: {} }
    'drivers.driver.earnings_history': { paramsTuple?: []; params?: {} }
    'drivers.driver.earnings_pdf': { paramsTuple?: []; params?: {} }
    'trips.trip.nearby': { paramsTuple?: []; params?: {} }
    'trips.trip.active': { paramsTuple?: []; params?: {} }
    'trips.trip.history': { paramsTuple?: []; params?: {} }
    'trips.trip.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'trips.chat.index': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'trips.offer.index': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'notifications.notification.index': { paramsTuple?: []; params?: {} }
    'admin.admin.dashboard': { paramsTuple?: []; params?: {} }
    'admin.admin.users': { paramsTuple?: []; params?: {} }
    'admin.admin.drivers': { paramsTuple?: []; params?: {} }
    'admin.admin.trips': { paramsTuple?: []; params?: {} }
    'admin.admin.earnings': { paramsTuple?: []; params?: {} }
    'admin.admin.profile': { paramsTuple?: []; params?: {} }
    'admin.admin.emergencies': { paramsTuple?: []; params?: {} }
    'admin.admin.conductor_debt': { paramsTuple?: []; params?: {} }
    'admin.admin.commission_history': { paramsTuple: [ParamValue]; params: {'conductorId': ParamValue} }
    'admin.admin.reports': { paramsTuple?: []; params?: {} }
    'admin.admin.disputes': { paramsTuple?: []; params?: {} }
    'admin.admin.pending_verifications': { paramsTuple?: []; params?: {} }
    'admin.admin.pending_payments': { paramsTuple?: []; params?: {} }
    'admin.admin.moderator_reports': { paramsTuple?: []; params?: {} }
    'admin.admin.backup_logs': { paramsTuple?: []; params?: {} }
    'admin.admin.cancellation_requests': { paramsTuple?: []; params?: {} }
    'favorites.favorite_route.index': { paramsTuple?: []; params?: {} }
    'support.support.help': { paramsTuple?: []; params?: {} }
    'support.support.emergency': { paramsTuple?: []; params?: {} }
    'disputes.dispute.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'payment.payment.info': { paramsTuple?: []; params?: {} }
    'payments.info': { paramsTuple?: []; params?: {} }
    'settings.settings.show': { paramsTuple?: []; params?: {} }
    'mapbox.token': { paramsTuple?: []; params?: {} }
    'moderator.moderator.my_comunicados': { paramsTuple?: []; params?: {} }
    'moderator.moderator.drivers_list': { paramsTuple?: []; params?: {} }
    'moderator.moderator.inactive_drivers': { paramsTuple?: []; params?: {} }
    'moderator.moderator.encuesta_results': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'avisos.moderator.avisos_index': { paramsTuple?: []; params?: {} }
    'leader.leader.avisos_index': { paramsTuple?: []; params?: {} }
    'leader.leader.my_comunicados': { paramsTuple?: []; params?: {} }
    'leader.leader.drivers_list': { paramsTuple?: []; params?: {} }
    'leader.leader.reports_limited': { paramsTuple?: []; params?: {} }
  }
  HEAD: {
    'users.profile.show': { paramsTuple?: []; params?: {} }
    'drivers.driver.earnings': { paramsTuple?: []; params?: {} }
    'drivers.driver.stats': { paramsTuple?: []; params?: {} }
    'drivers.driver.today_stats': { paramsTuple?: []; params?: {} }
    'drivers.driver.earnings_history': { paramsTuple?: []; params?: {} }
    'drivers.driver.earnings_pdf': { paramsTuple?: []; params?: {} }
    'trips.trip.nearby': { paramsTuple?: []; params?: {} }
    'trips.trip.active': { paramsTuple?: []; params?: {} }
    'trips.trip.history': { paramsTuple?: []; params?: {} }
    'trips.trip.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'trips.chat.index': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'trips.offer.index': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'notifications.notification.index': { paramsTuple?: []; params?: {} }
    'admin.admin.dashboard': { paramsTuple?: []; params?: {} }
    'admin.admin.users': { paramsTuple?: []; params?: {} }
    'admin.admin.drivers': { paramsTuple?: []; params?: {} }
    'admin.admin.trips': { paramsTuple?: []; params?: {} }
    'admin.admin.earnings': { paramsTuple?: []; params?: {} }
    'admin.admin.profile': { paramsTuple?: []; params?: {} }
    'admin.admin.emergencies': { paramsTuple?: []; params?: {} }
    'admin.admin.conductor_debt': { paramsTuple?: []; params?: {} }
    'admin.admin.commission_history': { paramsTuple: [ParamValue]; params: {'conductorId': ParamValue} }
    'admin.admin.reports': { paramsTuple?: []; params?: {} }
    'admin.admin.disputes': { paramsTuple?: []; params?: {} }
    'admin.admin.pending_verifications': { paramsTuple?: []; params?: {} }
    'admin.admin.pending_payments': { paramsTuple?: []; params?: {} }
    'admin.admin.moderator_reports': { paramsTuple?: []; params?: {} }
    'admin.admin.backup_logs': { paramsTuple?: []; params?: {} }
    'admin.admin.cancellation_requests': { paramsTuple?: []; params?: {} }
    'favorites.favorite_route.index': { paramsTuple?: []; params?: {} }
    'support.support.help': { paramsTuple?: []; params?: {} }
    'support.support.emergency': { paramsTuple?: []; params?: {} }
    'disputes.dispute.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'payment.payment.info': { paramsTuple?: []; params?: {} }
    'payments.info': { paramsTuple?: []; params?: {} }
    'settings.settings.show': { paramsTuple?: []; params?: {} }
    'mapbox.token': { paramsTuple?: []; params?: {} }
    'moderator.moderator.my_comunicados': { paramsTuple?: []; params?: {} }
    'moderator.moderator.drivers_list': { paramsTuple?: []; params?: {} }
    'moderator.moderator.inactive_drivers': { paramsTuple?: []; params?: {} }
    'moderator.moderator.encuesta_results': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'avisos.moderator.avisos_index': { paramsTuple?: []; params?: {} }
    'leader.leader.avisos_index': { paramsTuple?: []; params?: {} }
    'leader.leader.my_comunicados': { paramsTuple?: []; params?: {} }
    'leader.leader.drivers_list': { paramsTuple?: []; params?: {} }
    'leader.leader.reports_limited': { paramsTuple?: []; params?: {} }
  }
  POST: {
    'auth.auth.register': { paramsTuple?: []; params?: {} }
    'auth.auth.login': { paramsTuple?: []; params?: {} }
    'auth.auth.refresh_token': { paramsTuple?: []; params?: {} }
    'auth.auth.logout': { paramsTuple?: []; params?: {} }
    'users.profile.avatar': { paramsTuple?: []; params?: {} }
    'drivers.driver.vehicle_photo': { paramsTuple?: []; params?: {} }
    'drivers.driver.driver_photo': { paramsTuple?: []; params?: {} }
    'drivers.driver.upload_cedula': { paramsTuple?: []; params?: {} }
    'drivers.driver.upload_licencia': { paramsTuple?: []; params?: {} }
    'drivers.driver.upload_vehiculo': { paramsTuple?: []; params?: {} }
    'trips.trip.request': { paramsTuple?: []; params?: {} }
    'trips.trip.accept': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'trips.trip.decline': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'trips.trip.start_trip': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'trips.trip.complete': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'trips.trip.finalize': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'trips.trip.cancel': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'trips.trip.request_cancellation': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'trips.trip.rate': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'trips.trip.delivery_photo': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'trips.chat.store': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'trips.dispute.store': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'trips.dispute.appeal': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'trips.dispute.upload_support': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'trips.offer.store': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'trips.offer.accept': { paramsTuple: [ParamValue,ParamValue]; params: {'id': ParamValue,'offerId': ParamValue} }
    'trips.offer.reject': { paramsTuple: [ParamValue,ParamValue]; params: {'id': ParamValue,'offerId': ParamValue} }
    'trips.report.store': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.admin.upload_profile_avatar': { paramsTuple?: []; params?: {} }
    'admin.admin.manual_backup': { paramsTuple?: []; params?: {} }
    'admin.admin.approve_cancellation': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.admin.reject_cancellation': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'favorites.favorite_route.store': { paramsTuple?: []; params?: {} }
    'disputes.dispute.store_root': { paramsTuple?: []; params?: {} }
    'disputes.dispute.submit_version': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'payment.payment.upload_proof': { paramsTuple?: []; params?: {} }
    'moderator.moderator.store_comunicado': { paramsTuple?: []; params?: {} }
    'moderator.moderator.notify_driver': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'moderator.moderator.report_driver': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'moderator.moderator.store_encuesta': { paramsTuple?: []; params?: {} }
    'moderator.moderator.answer_encuesta': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'avisos.moderator.avisos_store': { paramsTuple?: []; params?: {} }
    'emergency.trigger': { paramsTuple?: []; params?: {} }
    'leader.leader.avisos_store': { paramsTuple?: []; params?: {} }
    'leader.leader.store_comunicado': { paramsTuple?: []; params?: {} }
  }
  PUT: {
    'users.profile.update': { paramsTuple?: []; params?: {} }
    'users.profile.update_fcm_token': { paramsTuple?: []; params?: {} }
    'drivers.driver.status': { paramsTuple?: []; params?: {} }
    'drivers.driver.location': { paramsTuple?: []; params?: {} }
    'notifications.notification.read': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.admin.update_user': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.admin.toggle_suspend_user': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.admin.upload_user_avatar': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.admin.resolve_emergency': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.admin.update_profile': { paramsTuple?: []; params?: {} }
    'admin.admin.mark_commission_paid': { paramsTuple: [ParamValue]; params: {'conductorId': ParamValue} }
    'admin.admin.resolve_report': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.admin.resolve_dispute': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.admin.clear_debt': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.admin.approve_driver': { paramsTuple: [ParamValue]; params: {'conductorId': ParamValue} }
    'admin.admin.reject_driver': { paramsTuple: [ParamValue]; params: {'conductorId': ParamValue} }
    'admin.admin.confirm_payment': { paramsTuple: [ParamValue]; params: {'userId': ParamValue} }
    'admin.admin.reject_payment': { paramsTuple: [ParamValue]; params: {'userId': ParamValue} }
    'admin.admin.update_config': { paramsTuple?: []; params?: {} }
    'admin.admin.update_coverage': { paramsTuple?: []; params?: {} }
    'admin.admin.update_banner': { paramsTuple?: []; params?: {} }
    'admin.admin.assign_moderator': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.admin.assign_leader': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.admin.approve_comunicado': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.admin.reject_comunicado': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.admin.approve_encuesta': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'settings.settings.update': { paramsTuple?: []; params?: {} }
    'avisos.moderator.avisos_pin': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'leader.leader.avisos_pin': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
  }
  DELETE: {
    'admin.admin.delete_user': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'favorites.favorite_route.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'avisos.moderator.avisos_delete': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'leader.leader.avisos_delete': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
  }
}
declare module '@adonisjs/core/types/http' {
  export interface RoutesList extends ScannedRoutes {}
}