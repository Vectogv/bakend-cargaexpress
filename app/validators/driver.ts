import vine from '@vinejs/vine'

export const driverStatusValidator = vine.create({
  online: vine.boolean(),
})

export const driverLocationValidator = vine.create({
  lat: vine.number().min(-90).max(90),
  lng: vine.number().min(-180).max(180),
})
