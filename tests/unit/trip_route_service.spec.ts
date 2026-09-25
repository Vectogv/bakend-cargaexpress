import { test } from '@japa/runner'
import {
  faseDe,
  posicionEnRuta,
  rutaDelViaje,
  limpiarCacheRutas,
  type Punto,
  type ProveedorRuta,
  REFRESCO_MS,
} from '#services/trip_route_service'

const ORIGEN: Punto = [2.4419, -76.6063]
const DESTINO: Punto = [2.4569, -76.5952]

/** Ruta recta de 3 tramos entre dos puntos (como si viniera de Mapbox). */
function rutaEntre(a: Punto, b: Punto): Punto[] {
  return [0, 1 / 3, 2 / 3, 1].map((t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t])
}

function proveedorFalso() {
  const llamadas: Array<[Punto, Punto]> = []
  const proveedor: ProveedorRuta = async (desde, hasta) => {
    llamadas.push([desde, hasta])
    return { coords: rutaEntre(desde, hasta), distanciaM: 3000, duracionSeg: 600 }
  }
  return { proveedor, llamadas }
}

const viaje = (estado: string) => ({
  id: 7,
  estado,
  origenLat: ORIGEN[0],
  origenLng: ORIGEN[1],
  destinoLat: DESTINO[0],
  destinoLng: DESTINO[1],
})

test.group('Ruta y ETA del viaje (trip_route_service)', (group) => {
  group.each.setup(() => limpiarCacheRutas())

  test('fase según el estado', ({ assert }) => {
    assert.equal(faseDe('aceptado'), 'recogida')
    assert.equal(faseDe('conductor_en_camino'), 'recogida')
    assert.equal(faseDe('conductor_llegada'), 'destino')
    assert.equal(faseDe('en_curso'), 'destino')
    assert.isNull(faseDe('finalizado'))
    assert.isNull(faseDe('sos'))
  })

  test('lo que falta se mide sobre la ruta y el desvío es la distancia a ella', ({ assert }) => {
    const ruta = rutaEntre(ORIGEN, DESTINO)
    const inicio = posicionEnRuta(ORIGEN, ruta)
    const medio = posicionEnRuta(ruta[2], ruta)
    assert.isBelow(inicio.desvioM, 1)
    assert.isBelow(medio.restanteM, inicio.restanteM)
    assert.closeTo(medio.restanteM / inicio.restanteM, 1 / 3, 0.02)
    const fuera = posicionEnRuta([ORIGEN[0] + 0.01, ORIGEN[1]], ruta)
    assert.isAbove(fuera.desvioM, 500)
  })

  test('una sola llamada a Mapbox por fase: el ETA baja con el avance sin volver a llamar', async ({
    assert,
  }) => {
    const { proveedor, llamadas } = proveedorFalso()
    const conductor: Punto = [ORIGEN[0] - 0.01, ORIGEN[1]]
    const ahora = 1_000_000
    const a = await rutaDelViaje(viaje('aceptado'), conductor, { proveedor, ahora })
    assert.equal(a!.ruta.fase, 'recogida')
    assert.isTrue(a!.recalculada)
    assert.equal(a!.etaMin, 10)

    const mitad = a!.ruta.coords[2]
    const b = await rutaDelViaje(viaje('conductor_en_camino'), mitad, {
      proveedor,
      ahora: ahora + 60_000,
    })
    assert.isFalse(b!.recalculada)
    assert.isBelow(b!.etaMin, a!.etaMin)
    assert.lengthOf(llamadas, 1)
  })

  test('recalcula al cambiar de fase, al desviarse o cuando la ruta envejece', async ({
    assert,
  }) => {
    const { proveedor, llamadas } = proveedorFalso()
    const ahora = 1_000_000
    await rutaDelViaje(viaje('aceptado'), [ORIGEN[0] - 0.01, ORIGEN[1]], { proveedor, ahora })
    // Cambio de fase: ahora hacia el destino.
    const d = await rutaDelViaje(viaje('en_curso'), ORIGEN, { proveedor, ahora: ahora + 1000 })
    assert.equal(d!.ruta.fase, 'destino')
    assert.lengthOf(llamadas, 2)
    // Desvío grande, pero antes de 30 s no se vuelve a llamar.
    const lejos: Punto = [ORIGEN[0] + 0.02, ORIGEN[1] - 0.02]
    await rutaDelViaje(viaje('en_curso'), lejos, { proveedor, ahora: ahora + 10_000 })
    assert.lengthOf(llamadas, 2)
    // Pasados 30 s con desvío: sí.
    await rutaDelViaje(viaje('en_curso'), lejos, { proveedor, ahora: ahora + 40_000 })
    assert.lengthOf(llamadas, 3)
    // Sobre la ruta pero vieja (> 5 min): refresco por tráfico.
    await rutaDelViaje(viaje('en_curso'), lejos, {
      proveedor,
      ahora: ahora + 40_000 + REFRESCO_MS + 1,
    })
    assert.lengthOf(llamadas, 4)
  })

  test('sin Mapbox usa la recta a 30 km/h y lo marca como aproximada', async ({ assert }) => {
    const proveedor: ProveedorRuta = async () => null
    const r = await rutaDelViaje(viaje('en_curso'), ORIGEN, { proveedor, ahora: 1 })
    assert.equal(r!.ruta.fuente, 'recta')
    assert.lengthOf(r!.ruta.coords, 2)
    assert.isAtLeast(r!.etaMin, 1)
  })

  test('fuera de las fases con ruta no se calcula nada', async ({ assert }) => {
    const { proveedor, llamadas } = proveedorFalso()
    assert.isNull(await rutaDelViaje(viaje('finalizado'), ORIGEN, { proveedor }))
    assert.lengthOf(llamadas, 0)
  })
})
