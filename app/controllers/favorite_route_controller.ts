import RutaFavorita from '#models/ruta_favorita'
import type { HttpContext } from '@adonisjs/core/http'

export default class FavoriteRouteController {
  async index({ auth, serialize }: HttpContext) {
    const user = auth.getUserOrFail()
    const rutas = await RutaFavorita.query().where('user_id', user.id).orderBy('created_at', 'desc')
    return serialize.withoutWrapping(
      rutas.map((r) => ({
        id: r.id,
        nombre: r.nombre,
        origen: { direccion: r.origenDireccion, lat: r.origenLat, lng: r.origenLng },
        destino: { direccion: r.destinoDireccion, lat: r.destinoLat, lng: r.destinoLng },
        createdAt: r.createdAt.toISO(),
      }))
    )
  }

  async store({ auth, request, response, serialize }: HttpContext) {
    const user = auth.getUserOrFail()
    const {
      nombre,
      origenDireccion,
      origenLat,
      origenLng,
      destinoDireccion,
      destinoLat,
      destinoLng,
    } = request.only([
      'nombre',
      'origenDireccion',
      'origenLat',
      'origenLng',
      'destinoDireccion',
      'destinoLat',
      'destinoLng',
    ])

    if (!nombre || !origenDireccion || !destinoDireccion) {
      return response
        .status(422)
        .send(serialize.withoutWrapping({ error: 'Nombre, origen y destino son requeridos' }))
    }

    const ruta = await RutaFavorita.create({
      userId: user.id,
      nombre,
      origenDireccion,
      origenLat: Number(origenLat),
      origenLng: Number(origenLng),
      destinoDireccion,
      destinoLat: Number(destinoLat),
      destinoLng: Number(destinoLng),
    })

    return serialize.withoutWrapping({
      id: ruta.id,
      nombre: ruta.nombre,
      origen: { direccion: ruta.origenDireccion, lat: ruta.origenLat, lng: ruta.origenLng },
      destino: { direccion: ruta.destinoDireccion, lat: ruta.destinoLat, lng: ruta.destinoLng },
      createdAt: ruta.createdAt.toISO(),
    })
  }

  async destroy({ auth, params, response, serialize }: HttpContext) {
    const user = auth.getUserOrFail()
    const ruta = await RutaFavorita.query().where('id', params.id).where('user_id', user.id).first()
    if (!ruta) {
      return response.status(404).send(serialize.withoutWrapping({ error: 'Ruta no encontrada' }))
    }
    await ruta.delete()
    return serialize.withoutWrapping({ success: true })
  }
}
