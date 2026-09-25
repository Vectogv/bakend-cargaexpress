import { updateProfileValidator } from '#validators/profile'
import type { HttpContext } from '@adonisjs/core/http'
import StorageService from '#services/storage_service'
import db from '@adonisjs/lucid/services/db'
import { randomUUID } from 'node:crypto'
import { ApiOperation, ApiBody, ApiResponse } from '@foadonis/openapi/decorators'
import SignedUploadService from '#services/signed_upload_service'
import logger from '@adonisjs/core/services/logger'

export default class ProfileController {
  @ApiOperation({
    summary: 'Obtener perfil del usuario',
    description: 'Devuelve el perfil del usuario autenticado con información del conductor',
  })
  @ApiResponse({ type: 'object' })
  async show({ auth, serialize }: HttpContext) {
    const user = auth.getUserOrFail()
    await (user as any).load('conductor')

    const result: Record<string, unknown> = {
      id: String(user.id),
      nombre: user.nombre,
      apellido: user.apellido,
      email: user.email,
      telefono: user.telefono,
      edad: user.edad,
      avatar: user.avatar,
      rol: user.rol,
      esModerador: Boolean(user.esModerador),
      zonaModerador: user.zonaModerador,
      calificacion: user.calificacion,
      contactoEmergenciaNombre: user.contactoEmergenciaNombre,
      contactoEmergenciaTelefono: user.contactoEmergenciaTelefono,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      conductor: user.conductor
        ? {
            id: String(user.conductor.id),
            usuarioId: String(user.conductor.usuarioId),
            cedula: user.conductor.cedula,
            placa: user.conductor.placa,
            tipoVehiculo: user.conductor.tipoVehiculo,
            capacidad: user.conductor.capacidad,
            fotoConductor: user.conductor.fotoConductor,
            fotoVehiculo: user.conductor.fotoVehiculo,
            online: user.conductor.online,
            calificacion: user.conductor.calificacion,
            totalViajes: user.conductor.totalViajes,
            horasActivo: user.conductor.horasActivo,
            ultimaUbicacionLat: user.conductor.ultimaUbicacionLat,
            ultimaUbicacionLng: user.conductor.ultimaUbicacionLng,
            estadoVerificacion: user.conductor.estadoVerificacion,
            fotoCedula: SignedUploadService.sign(user.conductor.fotoCedula),
            fotoLicencia: SignedUploadService.sign(user.conductor.fotoLicencia),
            notaRechazo: user.conductor.notaRechazo,
          }
        : undefined,
    }

    return serialize.withoutWrapping(result)
  }

  @ApiOperation({
    summary: 'Actualizar perfil del usuario',
    description: 'Actualiza los campos del perfil del usuario autenticado',
  })
  @ApiBody({ type: () => updateProfileValidator })
  @ApiResponse({ type: 'object' })
  async update({ auth, request, serialize, response }: HttpContext) {
    const data = await request.validateUsing(updateProfileValidator)
    const user = auth.getUserOrFail()

    if (data.nombre !== undefined) user.nombre = data.nombre
    if (data.apellido !== undefined) user.apellido = data.apellido
    if (data.telefono !== undefined) user.telefono = data.telefono
    if (data.edad !== undefined) user.edad = data.edad
    if (data.contactoEmergenciaNombre !== undefined)
      user.contactoEmergenciaNombre = data.contactoEmergenciaNombre
    if (data.contactoEmergenciaTelefono !== undefined)
      user.contactoEmergenciaTelefono = data.contactoEmergenciaTelefono

    if (data.email !== undefined && data.email !== user.email) {
      const exists = await db
        .from('users')
        .where('email', data.email)
        .whereNot('id', user.id)
        .first()
      if (exists) {
        return response.status(409).send({ error: 'El email ya está registrado' })
      }
      user.email = data.email
    }

    await user.save()

    return serialize.withoutWrapping({
      id: String(user.id),
      nombre: user.nombre,
      apellido: user.apellido,
      email: user.email,
      telefono: user.telefono,
      edad: user.edad,
      avatar: user.avatar,
      rol: user.rol,
      contactoEmergenciaNombre: user.contactoEmergenciaNombre,
      contactoEmergenciaTelefono: user.contactoEmergenciaTelefono,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    })
  }

  @ApiOperation({ summary: 'Subir avatar', description: 'Sube una nueva imagen de avatar del perfil' })
  @ApiResponse({ type: 'object' })
  async avatar({ auth, request, response, serialize }: HttpContext) {
    const user = auth.getUserOrFail()
    const file = request.file('file', {
      size: '5mb',
      extnames: ['jpg', 'jpeg', 'png', 'gif', 'webp'],
    })

    if (!file) {
      return response.status(400).send({ error: 'No file uploaded' })
    }

    if (!file.isValid) {
      return response.status(422).send({ error: file.errors[0]?.message || 'Archivo inválido' })
    }
    const fileName = `avatar-${user.id}-${randomUUID()}.${file.extname}`
    await file.move(StorageService.uploadsDir(), { name: fileName })

    user.avatar = `/storage/uploads/${fileName}`
    await user.save()

    return serialize.withoutWrapping({ avatar: user.avatar })
  }

  async updateFcmToken({ auth, request, serialize }: HttpContext) {
    const user = auth.getUserOrFail()
    const { fcmToken, error } = request.only(['fcmToken', 'error'])
    // La app informa por qué no obtuvo el token (diagnóstico); no se borra
    // el token que ya hubiera.
    if (!fcmToken && error) {
      logger.warn(`Usuario ${user.id} sin token FCM: ${String(error).slice(0, 300)}`)
      return serialize.withoutWrapping({ fcmToken: user.fcmToken ? 'registrado' : null })
    }
    user.fcmToken = fcmToken || null
    await user.save()
    logger.info(
      `Token FCM ${fcmToken ? `registrado (…${String(fcmToken).slice(-8)})` : 'borrado'} para usuario ${user.id}`
    )
    return serialize.withoutWrapping({ fcmToken: user.fcmToken })
  }
}
