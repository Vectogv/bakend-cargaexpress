/* eslint-disable prettier/prettier */
import type { routes } from './index.ts'

export interface ApiDefinition {
  auth: {
    auth: {
      register: typeof routes['auth.auth.register']
      login: typeof routes['auth.auth.login']
      refreshToken: typeof routes['auth.auth.refresh_token']
    }
  }
  users: {
    profile: {
      show: typeof routes['users.profile.show']
      update: typeof routes['users.profile.update']
      avatar: typeof routes['users.profile.avatar']
    }
  }
  drivers: {
    driver: {
      status: typeof routes['drivers.driver.status']
      earnings: typeof routes['drivers.driver.earnings']
      stats: typeof routes['drivers.driver.stats']
      todayStats: typeof routes['drivers.driver.today_stats']
      vehiclePhoto: typeof routes['drivers.driver.vehicle_photo']
      location: typeof routes['drivers.driver.location']
      driverPhoto: typeof routes['drivers.driver.driver_photo']
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
      updateProfile: typeof routes['admin.admin.update_profile']
      uploadProfileAvatar: typeof routes['admin.admin.upload_profile_avatar']
    }
  }
  support: {
    support: {
      help: typeof routes['support.support.help']
      emergency: typeof routes['support.support.emergency']
    }
  }
}
