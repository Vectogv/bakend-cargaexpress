import Oferta from '#models/oferta'
import Viaje from '#models/viaje'
import Conductor from '#models/conductor'
import User from '#models/user'
import type { HttpContext } from '@adonisjs/core/http'
import { DateTime } from 'luxon'
import { getIO, emitToDriver } from '#start/socket'
import { sendToToken } from '#services/push_notification_service'

export default class OfferController {
  async store({ auth, request, response, params }: HttpContext) {
    const user = auth.getUserOrFail()
    if (user.rol !== 'conductor') {
      return response.status(403).send({ error: 'Solo los conductores pueden hacer ofertas' })
    }

    const conductor = await user.related('conductor').query().first()
    if (!conductor) {
      return response.status(400).json({
        message: 'Debes completar tu registro como conductor primero',
      })
    }

    const viaje = await Viaje.find(params.id)

    if (!viaje) {
      return response.status(404).send({ error: 'Viaje no encontrado' })
    }
    if (viaje.estado !== 'buscando_conductor') {
      return response.status(400).send({ error: 'El viaje ya no acepta ofertas' })
    }

    const monto = Number.parseFloat(request.input('monto'))
    if (!monto || monto < 0) {
      return response.status(422).send({ error: 'Monto inválido' })
    }

    const existeOferta = await Oferta.query()
      .where('viaje_id', viaje.id)
      .where('conductor_id', conductor.id)
      .where('estado', 'pendiente')
      .first()

    if (existeOferta) {
      return response.status(400).send({ error: 'Ya has hecho una oferta para este viaje' })
    }

    const oferta = await Oferta.create({
      viajeId: viaje.id,
      conductorId: conductor.id,
      monto,
      estado: 'pendiente',
    })

    await conductor.load('usuario')

    const io = getIO()
    io.to(`client:${viaje.clienteId}`).emit('offer:new', {
      id: String(oferta.id),
      viajeId: String(oferta.viajeId),
      monto: oferta.monto,
      conductor: {
        id: String(conductor.id),
        nombre: `${conductor.usuario?.nombre || ''} ${conductor.usuario?.apellido || ''}`.trim(),
        foto: conductor.fotoConductor,
        calificacion: conductor.calificacion,
        placa: conductor.placa,
        tipoVehiculo: conductor.tipoVehiculo,
      },
      createdAt: oferta.createdAt.toISO(),
    })

    const cliente = await User.find(viaje.clienteId)
    if (cliente?.fcmToken) {
      await sendToToken(
        cliente.fcmToken,
        'Nueva oferta recibida',
        `Conductor ofrece $${oferta.monto} para tu viaje`
      )
    }

    return response.status(201).send({
      id: String(oferta.id),
      viajeId: String(oferta.viajeId),
      monto: oferta.monto,
      estado: oferta.estado,
      createdAt: oferta.createdAt.toISO(),
    })
  }

  async index({ auth, params, response }: HttpContext) {
    const user = auth.getUserOrFail()
    const viaje = await Viaje.find(params.id)

    if (!viaje) {
      return response.status(404).send({ error: 'Viaje no encontrado' })
    }
    if (viaje.clienteId !== user.id) {
      return response.status(403).send({ error: 'Este viaje no te pertenece' })
    }

    const ofertas = await Oferta.query()
      .where('viaje_id', viaje.id)
      .where('estado', 'pendiente')
      .preload('conductor', (q) => q.preload('usuario'))
      .orderBy('createdAt', 'asc')

    return ofertas.map((o) => ({
      id: String(o.id),
      monto: o.monto,
      conductor: {
        id: String(o.conductor.id),
        nombre: `${o.conductor.usuario?.nombre || ''} ${o.conductor.usuario?.apellido || ''}`.trim(),
        foto: o.conductor.fotoConductor,
        calificacion: o.conductor.calificacion,
        placa: o.conductor.placa,
        tipoVehiculo: o.conductor.tipoVehiculo,
      },
      createdAt: o.createdAt.toISO(),
    }))
  }

  async accept({ auth, params, response }: HttpContext) {
    const user = auth.getUserOrFail()
    const viaje = await Viaje.find(params.id)

    if (!viaje) {
      return response.status(404).send({ error: 'Viaje no encontrado' })
    }
    if (viaje.clienteId !== user.id) {
      return response.status(403).send({ error: 'Este viaje no te pertenece' })
    }

    const oferta = await Oferta.query()
      .where('id', params.offerId)
      .where('viaje_id', viaje.id)
      .where('estado', 'pendiente')
      .preload('conductor', (q) => q.preload('usuario'))
      .preload('viaje')
      .first()

    if (!oferta) {
      return response.status(404).send({ error: 'Oferta no encontrada o ya procesada' })
    }

    oferta.estado = 'aceptada'
    await oferta.save()

    await Oferta.query()
      .where('viaje_id', viaje.id)
      .where('id', '!=', oferta.id)
      .where('estado', 'pendiente')
      .update({ estado: 'rechazada' })

    viaje.conductorId = oferta.conductorId
    viaje.estado = 'aceptado'
    viaje.precioFinal = oferta.monto
    viaje.aceptadoAt = DateTime.now()
    await viaje.save()

    const io = getIO()
    io.to(`driver:${oferta.conductor.usuarioId}`).emit('offer:accepted', {
      viajeId: String(viaje.id),
      ofertaId: String(oferta.id),
      monto: oferta.monto,
      estado: 'aceptado',
    })

    if (oferta.conductor.usuario.fcmToken) {
      await sendToToken(
        oferta.conductor.usuario.fcmToken,
        'Oferta aceptada',
        `Tu oferta de $${oferta.monto} fue aceptada. Dirígete al origen del viaje`
      )
    }

    const otrasOfertas = await Oferta.query()
      .where('viaje_id', viaje.id)
      .where('estado', 'rechazada')
      .preload('conductor')

    for (const otra of otrasOfertas) {
      io.to(`driver:${otra.conductor.usuarioId}`).emit('offer:rejected', {
        viajeId: String(viaje.id),
        ofertaId: String(otra.id),
      })
      if (otra.conductor?.usuario?.fcmToken) {
        await sendToToken(
          otra.conductor.usuario.fcmToken,
          'Oferta rechazada',
          'Tu oferta para un viaje no fue seleccionada'
        )
      }
    }

    // Emitir trip:accepted a TODOS los conductores online (excepto el que aceptó)
    const tripAcceptedPayload = {
      event: 'trip:accepted',
      tripId: Number(viaje.id),
      conductorId: Number(oferta.conductorId),
    }
    const todosConductores = await Conductor.query()
      .where('online', true)
      .where('id', '!=', oferta.conductorId)
    for (const c of todosConductores) {
      emitToDriver(c.usuarioId, 'trip:accepted', tripAcceptedPayload)
    }

    return {
      id: String(viaje.id),
      estado: viaje.estado,
      ofertaId: String(oferta.id),
      conductorId: String(oferta.conductorId),
      precioFinal: viaje.precioFinal,
    }
  }
}
