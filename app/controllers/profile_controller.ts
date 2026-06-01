import { updateProfileValidator } from '#validators/profile'
import type { HttpContext } from '@adonisjs/core/http'
import app from '@adonisjs/core/services/app'
import db from '@adonisjs/lucid/services/db'
import { randomUUID } from 'node:crypto'
import { ApiOperation, ApiBody, ApiResponse } from '@foadonis/openapi/decorators'

export default class ProfileController {
  @ApiOperation({
    summary: 'Get user profile',
    description: 'Returns the authenticated user profile with conductor info',
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
          }
        : undefined,
    }

    return serialize.withoutWrapping(result)
  }

  @ApiOperation({
    summary: 'Update user profile',
    description: 'Updates the authenticated user profile fields',
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

  @ApiOperation({ summary: 'Upload avatar', description: 'Uploads a new profile avatar image' })
  @ApiResponse({ type: 'object' })
  async avatar({ auth, request, serialize }: HttpContext) {
    const user = auth.getUserOrFail()
    const file = request.file('file', {
      size: '5mb',
      extnames: ['jpg', 'jpeg', 'png', 'gif', 'webp'],
    })

    if (!file) {
      return serialize.withoutWrapping({ error: 'No file uploaded' })
    }

    const fileName = `avatar-${user.id}-${randomUUID()}.${file.extname}`
    await file.move(app.makePath('storage', 'uploads'), { name: fileName })

    user.avatar = `/storage/uploads/${fileName}`
    await user.save()

    return serialize.withoutWrapping({ avatar: user.avatar })
  }

  async updateFcmToken({ auth, request, serialize }: HttpContext) {
    const user = auth.getUserOrFail()
    const { fcmToken } = request.only(['fcmToken'])
    user.fcmToken = fcmToken || null
    await user.save()
    return serialize.withoutWrapping({ fcmToken: user.fcmToken })
  }
}
