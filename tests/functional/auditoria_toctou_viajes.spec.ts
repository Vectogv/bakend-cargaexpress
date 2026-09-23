import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import ConfiguracionPlataforma from '#models/configuracion_plataforma'
import GeoService from '#services/geo_service'

/**
 * Auditoría IMPORTANTE #3: la verificación "¿el cliente ya tiene un viaje
 * activo / esa reserva?" y la creación del viaje deben ser atómicas.
 * Dos solicitudes simultáneas del mismo cliente solo pueden crear un viaje.
 */

const uniq = () => `${Date.now()}${Math.floor(Math.random() * 1e6)}`
const ORIGEN = { direccion: 'Origen toctou', lat: 2.4419, lng: -76.6063 }
const DESTINO = { direccion: 'Destino toctou', lat: 2.4569, lng: -76.5952 }

async function registrarCliente(client: any) {
  const res = await client.post('/api/auth/register').json({
    nombre: 'Cli',
    apellido: 'Toctou',
    email: `toctou_${uniq()}@test.com`,
    password: 'Password123',
    rol: 'cliente',
    edad: 30,
  })
  res.assertStatus(200)
  return { token: res.body().token as string, id: Number(res.body().id) }
}

test.group('Auditoría #3 - creación atómica de viajes y reservas', (group) => {
  group.each.setup(async () => {
    await ConfiguracionPlataforma.query().delete()

    // Ensancha la ventana de carrera: la validación de cobertura corre entre
    // la verificación de viaje activo y el INSERT. Sin atomicidad, las
    // solicitudes concurrentes pasan todas la verificación.
    const original = GeoService.validarCobertura
    GeoService.validarCobertura = async (...args: Parameters<typeof original>) => {
      await new Promise((r) => setTimeout(r, 150))
      return original.apply(GeoService, args)
    }
    return () => {
      GeoService.validarCobertura = original
    }
  })

  test('dos solicitudes simultáneas crean un solo viaje inmediato', async ({ client, assert }) => {
    const cliente = await registrarCliente(client)
    const pedir = () =>
      client.post('/api/trips/request').bearerToken(cliente.token).json({
        origen: ORIGEN,
        destino: DESTINO,
        descripcion: 'Doble tap',
        precioCliente: 30000,
      })

    const respuestas = await Promise.all([pedir(), pedir(), pedir()])
    const estados = respuestas.map((r) => r.status()).sort()
    assert.deepEqual(estados, [200, 409, 409])

    const viajes = await db.from('viajes').where('cliente_id', cliente.id)
    assert.lengthOf(viajes, 1)
  })

  test('dos reservas simultáneas para el mismo horario crean una sola', async ({ client, assert }) => {
    const cliente = await registrarCliente(client)
    const fecha = DateTime.now().setZone('America/Bogota').plus({ days: 3 }).toISODate()!
    const reservar = () =>
      client.post('/api/trips/reserve').bearerToken(cliente.token).json({
        origen: ORIGEN,
        destino: DESTINO,
        descripcion: 'Reserva doble',
        precioCliente: 30000,
        fechaProgramada: fecha,
        horaProgramada: '10:30',
      })

    const respuestas = await Promise.all([reservar(), reservar(), reservar()])
    const estados = respuestas.map((r) => r.status()).sort()
    assert.deepEqual(estados, [201, 409, 409])

    const reservas = await db.from('viajes').where('cliente_id', cliente.id)
    assert.lengthOf(reservas, 1)
  })
})
