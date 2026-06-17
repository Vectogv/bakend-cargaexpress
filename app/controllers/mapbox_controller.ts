import env from '#start/env'
import type { HttpContext } from '@adonisjs/core/http'

export default class MapboxController {
  async token({ serialize }: HttpContext) {
    return serialize.withoutWrapping({
      mapboxAccessToken: env.get('MAPBOX_ACCESS_TOKEN', ''),
    })
  }
}