/* eslint-disable prettier/prettier */
import type { routes } from './index.ts'

export interface ApiDefinition {
  auth: {
    auth: {
      register: typeof routes['auth.auth.register']
      login: typeof routes['auth.auth.login']
      refreshToken: typeof routes['auth.auth.refresh_token']
      logout: typeof routes['auth.auth.logout']
    }
  }
  users: {
    profile: {
      show: typeof routes['users.profile.show']
      update: typeof routes['users.profile.update']
      avatar: typeof routes['users.profile.avatar']
      updateFcmToken: typeof routes['users.profile.update_fcm_token']
    }
  }
  drivers: {
    driver: {
      status: typeof routes['drivers.driver.status']
      earnings: typeof routes['drivers.driver.earnings']
      stats: typeof routes['drivers.driver.stats']
      todayStats: typeof routes['drivers.driver.today_stats']
      earningsHistory: typeof routes['drivers.driver.earnings_history']
      earningsPdf: typeof routes['drivers.driver.earnings_pdf']
      vehiclePhoto: typeof routes['drivers.driver.vehicle_photo']
      location: typeof routes['drivers.driver.location']
      driverPhoto: typeof routes['drivers.driver.driver_photo']
      uploadCedula: typeof routes['drivers.driver.upload_cedula']
      uploadLicencia: typeof routes['drivers.driver.upload_licencia']
      uploadVehiculo: typeof routes['drivers.driver.upload_vehiculo']
    }
  }
  trips: {
    trip: {
      request: typeof routes['trips.trip.request']
      nearby: typeof routes['trips.trip.nearby']
      active: typeof routes['trips.trip.active']
      history: typeof routes['trips.trip.history']
      show: typeof routes['trips.trip.show']
      accept: typeof routes['trips.trip.accept']
      decline: typeof routes['trips.trip.decline']
      startTrip: typeof routes['trips.trip.start_trip']
      complete: typeof routes['trips.trip.complete']
      finalize: typeof routes['trips.trip.finalize']
      cancel: typeof routes['trips.trip.cancel']
      requestCancellation: typeof routes['trips.trip.request_cancellation']
      rate: typeof routes['trips.trip.rate']
      deliveryPhoto: typeof routes['trips.trip.delivery_photo']
    }
    chat: {
      index: typeof routes['trips.chat.index']
      store: typeof routes['trips.chat.store']
    }
    dispute: {
      store: typeof routes['trips.dispute.store']
      appeal: typeof routes['trips.dispute.appeal']
      uploadSupport: typeof routes['trips.dispute.upload_support']
    }
    offer: {
      index: typeof routes['trips.offer.index']
      store: typeof routes['trips.offer.store']
      accept: typeof routes['trips.offer.accept']
      reject: typeof routes['trips.offer.reject']
    }
    report: {
      store: typeof routes['trips.report.store']
    }
  }
  notifications: {
    notification: {
      index: typeof routes['notifications.notification.index']
      read: typeof routes['notifications.notification.read']
    }
  }
  admin: {
    admin: {
      dashboard: typeof routes['admin.admin.dashboard']
      users: typeof routes['admin.admin.users']
      drivers: typeof routes['admin.admin.drivers']
      trips: typeof routes['admin.admin.trips']
      earnings: typeof routes['admin.admin.earnings']
      updateUser: typeof routes['admin.admin.update_user']
      toggleSuspendUser: typeof routes['admin.admin.toggle_suspend_user']
      uploadUserAvatar: typeof routes['admin.admin.upload_user_avatar']
      deleteUser: typeof routes['admin.admin.delete_user']
      profile: typeof routes['admin.admin.profile']
      emergencies: typeof routes['admin.admin.emergencies']
      resolveEmergency: typeof routes['admin.admin.resolve_emergency']
      updateProfile: typeof routes['admin.admin.update_profile']
      uploadProfileAvatar: typeof routes['admin.admin.upload_profile_avatar']
      conductorDebt: typeof routes['admin.admin.conductor_debt']
      markCommissionPaid: typeof routes['admin.admin.mark_commission_paid']
      commissionHistory: typeof routes['admin.admin.commission_history']
      reports: typeof routes['admin.admin.reports']
      resolveReport: typeof routes['admin.admin.resolve_report']
      disputes: typeof routes['admin.admin.disputes']
      resolveDispute: typeof routes['admin.admin.resolve_dispute']
      clearDebt: typeof routes['admin.admin.clear_debt']
      pendingVerifications: typeof routes['admin.admin.pending_verifications']
      approveDriver: typeof routes['admin.admin.approve_driver']
      rejectDriver: typeof routes['admin.admin.reject_driver']
      pendingPayments: typeof routes['admin.admin.pending_payments']
      confirmPayment: typeof routes['admin.admin.confirm_payment']
      rejectPayment: typeof routes['admin.admin.reject_payment']
      updateConfig: typeof routes['admin.admin.update_config']
      updateCoverage: typeof routes['admin.admin.update_coverage']
      updateBanner: typeof routes['admin.admin.update_banner']
      assignModerator: typeof routes['admin.admin.assign_moderator']
      assignLeader: typeof routes['admin.admin.assign_leader']
      approveComunicado: typeof routes['admin.admin.approve_comunicado']
      rejectComunicado: typeof routes['admin.admin.reject_comunicado']
      approveEncuesta: typeof routes['admin.admin.approve_encuesta']
      moderatorReports: typeof routes['admin.admin.moderator_reports']
      backupLogs: typeof routes['admin.admin.backup_logs']
      manualBackup: typeof routes['admin.admin.manual_backup']
      cancellationRequests: typeof routes['admin.admin.cancellation_requests']
      approveCancellation: typeof routes['admin.admin.approve_cancellation']
      rejectCancellation: typeof routes['admin.admin.reject_cancellation']
    }
  }
  favorites: {
    favoriteRoute: {
      index: typeof routes['favorites.favorite_route.index']
      store: typeof routes['favorites.favorite_route.store']
      destroy: typeof routes['favorites.favorite_route.destroy']
    }
  }
  support: {
    support: {
      help: typeof routes['support.support.help']
      emergency: typeof routes['support.support.emergency']
    }
  }
  disputes: {
    dispute: {
      storeRoot: typeof routes['disputes.dispute.store_root']
      show: typeof routes['disputes.dispute.show']
    }
  }
  payment: {
    payment: {
      info: typeof routes['payment.payment.info']
      uploadProof: typeof routes['payment.payment.upload_proof']
    }
  }
  payments: {
    info: typeof routes['payments.info']
  }
  settings: {
    settings: {
      show: typeof routes['settings.settings.show']
      update: typeof routes['settings.settings.update']
    }
  }
  mapbox: {
    token: typeof routes['mapbox.token']
  }
  moderator: {
    moderator: {
      storeComunicado: typeof routes['moderator.moderator.store_comunicado']
      myComunicados: typeof routes['moderator.moderator.my_comunicados']
      driversList: typeof routes['moderator.moderator.drivers_list']
      inactiveDrivers: typeof routes['moderator.moderator.inactive_drivers']
      notifyDriver: typeof routes['moderator.moderator.notify_driver']
      reportDriver: typeof routes['moderator.moderator.report_driver']
      storeEncuesta: typeof routes['moderator.moderator.store_encuesta']
      encuestaResults: typeof routes['moderator.moderator.encuesta_results']
      answerEncuesta: typeof routes['moderator.moderator.answer_encuesta']
    }
  }
  avisos: {
    moderator: {
      avisosIndex: typeof routes['avisos.moderator.avisos_index']
      avisosStore: typeof routes['avisos.moderator.avisos_store']
      avisosPin: typeof routes['avisos.moderator.avisos_pin']
      avisosDelete: typeof routes['avisos.moderator.avisos_delete']
    }
  }
  emergency: {
    trigger: typeof routes['emergency.trigger']
  }
  leader: {
    leader: {
      avisosIndex: typeof routes['leader.leader.avisos_index']
      avisosStore: typeof routes['leader.leader.avisos_store']
      avisosPin: typeof routes['leader.leader.avisos_pin']
      avisosDelete: typeof routes['leader.leader.avisos_delete']
      storeComunicado: typeof routes['leader.leader.store_comunicado']
      myComunicados: typeof routes['leader.leader.my_comunicados']
      driversList: typeof routes['leader.leader.drivers_list']
      reportsLimited: typeof routes['leader.leader.reports_limited']
    }
  }
}
