import { updateProfileValidator, changePasswordValidator } from '#validators/profile'
import type { HttpContext } from '@adonisjs/core/http'
import StorageService from '#services/storage_service'
import { randomUUID } from 'node:crypto'
import { ApiOperation, ApiBody, ApiResponse } from '@foadonis/openapi/decorators'
import SignedUploadService from '#services/signed_upload_service'
import SessionService from '#services/session_service'
import hash from '@adonisjs/core/services/hash'
import logger from '@adonisjs/core/services/logger'
import User from '#models/user'
import ArchivadoCuentaService from '#services/archivado_cuenta_service'
import EmpresaService from '#services/empresa_service'
import { DateTime } from 'luxon'

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
      cedula: user.cedula,
      registroCompleto: Boolean(user.registroCompleto),
      avatar: user.avatar,
      rol: user.rol,
      esModerador: Boolean(user.esModerador),
      zonaModerador: user.zonaModerador,
      empresa: await EmpresaService.empresaDe(user),
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
            modeloVehiculo: user.conductor.modeloVehiculo,
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
            ...user.conductor.documentosExtra(SignedUploadService.sign),
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
  async update({ auth, request, serialize }: HttpContext) {
    const data = await request.validateUsing(updateProfileValidator)
    const user = auth.getUserOrFail()

    // El email es el usuario de inicio de sesión: nunca se cambia desde acá
    // (decisión del negocio, ver CLAUDE.local.md §7.4.1). Si llega en el body
    // (la app ya no lo manda) se ignora en silencio, sin romper el resto del update.
    if (data.nombre !== undefined) user.nombre = data.nombre
    if (data.apellido !== undefined) user.apellido = data.apellido
    if (data.telefono !== undefined) user.telefono = data.telefono
    if (data.edad !== undefined) user.edad = data.edad
    if (data.cedula !== undefined) user.cedula = data.cedula
    // Último paso del asistente de registro del cliente.
    if (data.aceptaTerminos === true) {
      user.registroCompleto = true
      user.terminosAceptadosAt = user.terminosAceptadosAt ?? DateTime.now()
    }
    if (data.contactoEmergenciaNombre !== undefined)
      user.contactoEmergenciaNombre = data.contactoEmergenciaNombre
    if (data.contactoEmergenciaTelefono !== undefined)
      user.contactoEmergenciaTelefono = data.contactoEmergenciaTelefono

    await user.save()

    return serialize.withoutWrapping({
      id: String(user.id),
      nombre: user.nombre,
      apellido: user.apellido,
      email: user.email,
      telefono: user.telefono,
      edad: user.edad,
      cedula: user.cedula,
      registroCompleto: Boolean(user.registroCompleto),
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
    // Un token pertenece a un solo usuario (el celular cambió de cuenta).
    if (fcmToken) {
      await User.query().where('fcm_token', fcmToken).whereNot('id', user.id).update({ fcm_token: null })
    }
    user.fcmToken = fcmToken || null
    await user.save()
    logger.info(
      `Token FCM ${fcmToken ? `registrado (…${String(fcmToken).slice(-8)})` : 'borrado'} para usuario ${user.id}`
    )
    return serialize.withoutWrapping({ fcmToken: user.fcmToken })
  }

  @ApiOperation({
    summary: 'Cambiar contraseña',
    description: 'Cambia la contraseña del usuario autenticado verificando la actual',
  })
  @ApiBody({ type: () => changePasswordValidator })
  @ApiResponse({ type: 'object' })
  async changePassword({ auth, request, response, serialize }: HttpContext) {
    const { actual, nueva } = await request.validateUsing(changePasswordValidator)
    const user = auth.getUserOrFail()

    const actualOk = await hash.verify(user.password, actual)
    if (!actualOk) {
      return response.status(422).send({ message: 'La contraseña actual no es correcta' })
    }

    user.password = nueva
    await user.save()

    // Cierra las otras sesiones (mismo patrón que el reseteo del admin), pero
    // deja viva la sesión actual: quien cambia la contraseña no se desloguea a sí mismo.
    const tokenActual = user.currentAccessToken?.identifier
    await SessionService.revokeAll(user, tokenActual === undefined ? undefined : String(tokenActual))

    return serialize.withoutWrapping({ message: 'Contraseña actualizada' })
  }

  @ApiOperation({
    summary: 'Archivar mi cuenta',
    description: 'Archiva la cuenta (no borra datos). 409 si hay algo pendiente.',
  })
  @ApiResponse({ type: 'object' })
  async destroy({ auth, response, serialize }: HttpContext) {
    const user = auth.getUserOrFail()
    const bloqueo = await ArchivadoCuentaService.archivar(user)
    if (bloqueo) return response.status(409).send({ message: bloqueo })
    return serialize.withoutWrapping({ message: 'Tu cuenta fue archivada' })
  }
}
