import UserSetting from '#models/user_setting'
import { updateSettingsValidator } from '#validators/settings'
import type { HttpContext } from '@adonisjs/core/http'

export default class SettingsController {
  async show({ auth, serialize }: HttpContext) {
    const user = auth.getUserOrFail()
    let settings = await UserSetting.query().where('user_id', user.id).first()
    if (!settings) {
      settings = await UserSetting.create({ userId: user.id })
    }
    return serialize.withoutWrapping({
      idioma: settings.idioma,
      notificacionesSonido: settings.notificacionesSonido,
      visibilidad: settings.visibilidad,
    })
  }

  async update({ auth, request, serialize }: HttpContext) {
    const data = await request.validateUsing(updateSettingsValidator)
    const user = auth.getUserOrFail()
    let settings = await UserSetting.query().where('user_id', user.id).first()
    if (!settings) {
      settings = new UserSetting()
      settings.userId = user.id
    }
    if (data.idioma !== undefined) settings.idioma = data.idioma
    if (data.notificacionesSonido !== undefined) settings.notificacionesSonido = data.notificacionesSonido
    if (data.visibilidad !== undefined) settings.visibilidad = data.visibilidad
    await settings.save()

    return serialize.withoutWrapping({
      idioma: settings.idioma,
      notificacionesSonido: settings.notificacionesSonido,
      visibilidad: settings.visibilidad,
    })
  }
}
