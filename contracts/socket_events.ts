export const SOCKET_EVENTS = {
  TRIP_STATUS: 'trip:status_changed',
  OFFER_ACCEPTED: 'offer:accepted',
  NEW_OFFER: 'new:offer',
  DRIVER_ON_WAY: 'driver:on_the_way',
  DRIVER_ARRIVED: 'driver:arrived',
  TRIP_STARTED: 'trip:started',
  TRIP_FINALIZED: 'trip:finalized',
  TRIP_CANCELLED: 'trip:cancelled',
  CHAT_MESSAGE: 'chat:message',
  SOS: 'sos:activated',
  PAYMENT_OK: 'payment:confirmed',
  PAYMENT_FAIL: 'payment:rejected',
} as const
