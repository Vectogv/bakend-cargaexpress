import { test } from '@japa/runner'
import CoverageService, {
  claveDe,
  contiene,
  normalizarZona,
  validarZonasEntrada,
  type Zona,
} from '#services/coverage_service'

// Rectángulos aproximados de Cali y Popayán.
const CALI = { nombre: 'Cali', norte: 3.52, sur: 3.33, este: -76.45, oeste: -76.6 }
const POPAYAN = { nombre: 'Popayán', norte: 2.5, sur: 2.4, este: -76.55, oeste: -76.66 }

test.group('Unit - CoverageService', () => {
  test('claveDe quita tildes y normaliza', ({ assert }) => {
    assert.equal(claveDe('Popayán'), 'popayan')
    assert.equal(claveDe('  San Andrés de Tumaco '), 'san_andres_de_tumaco')
  })

  test('valida zonas rectangulares correctas', ({ assert }) => {
    const r = validarZonasEntrada([CALI, POPAYAN])
    assert.notProperty(r, 'error')
    if ('zonas' in r) {
      assert.deepEqual(r.zonas.map((z) => z.clave), ['cali', 'popayan'])
      assert.isTrue(r.zonas.every((z) => z.activa))
    }
  })

  test('rechaza límites invertidos, repetidos y fuera de rango', ({ assert }) => {
    assert.property(validarZonasEntrada([{ ...CALI, norte: 3.3, sur: 3.5 }]), 'error')
    assert.property(validarZonasEntrada([{ ...CALI, este: -76.7 }]), 'error')
    assert.property(validarZonasEntrada([CALI, { ...CALI }]), 'error')
    assert.property(validarZonasEntrada([{ ...CALI, norte: 95 }]), 'error')
    assert.property(validarZonasEntrada([{ ...CALI, nombre: '' }]), 'error')
    assert.property(validarZonasEntrada('no-es-lista'), 'error')
  })

  test('valida zonas circulares (centro y radio en km)', ({ assert }) => {
    const r = validarZonasEntrada([{ nombre: 'Pasto', tipo: 'circulo', lat: 1.2136, lng: -77.2811, radio: 15 }])
    assert.notProperty(r, 'error')
    if ('zonas' in r) {
      const zona = r.zonas[0]
      assert.equal(zona.tipo, 'circulo')
      assert.equal(zona.clave, 'pasto')
      if (zona.tipo === 'circulo') assert.equal(zona.radio, 15)
    }
    // También se acepta sin `tipo`, deduciendo por centro + radio.
    assert.notProperty(validarZonasEntrada([{ nombre: 'Cali centro', lat: 3.45, lng: -76.53, radio: 8 }]), 'error')
  })

  test('rechaza círculos inválidos', ({ assert }) => {
    const base = { nombre: 'Pasto', tipo: 'circulo', lat: 1.21, lng: -77.28 }
    assert.property(validarZonasEntrada([{ ...base, radio: 0 }]), 'error')
    assert.property(validarZonasEntrada([{ ...base, radio: 500 }]), 'error')
    assert.property(validarZonasEntrada([{ ...base, radio: 10, lat: 95 }]), 'error')
    assert.property(validarZonasEntrada([{ nombre: 'Sin radio', tipo: 'circulo', lat: 1.21, lng: -77.28 }]), 'error')
  })

  test('mezcla rectángulos y círculos en la misma configuración', ({ assert }) => {
    const r = validarZonasEntrada([CALI, { nombre: 'Pasto', tipo: 'circulo', lat: 1.2136, lng: -77.2811, radio: 12, activa: false }])
    assert.notProperty(r, 'error')
    if ('zonas' in r) {
      assert.deepEqual(r.zonas.map((z) => z.tipo), ['rect', 'circulo'])
      assert.isFalse(r.zonas[1].activa)
    }
  })

  test('contiene() para rectángulos y círculos antiguos', ({ assert }) => {
    const cali = normalizarZona(CALI)!
    assert.isTrue(contiene(cali, 3.45, -76.53))
    assert.isFalse(contiene(cali, 2.44, -76.61))

    const circulo = normalizarZona({ nombre: 'Pasto', centro: { lat: 1.21, lng: -77.28 }, radio: 15 })!
    assert.equal(circulo.tipo, 'circulo')
    assert.isTrue(contiene(circulo, 1.22, -77.27))
    assert.isFalse(contiene(circulo, 3.45, -76.53))
  })

  test('zonaDeEn devuelve la zona activa que contiene el punto', ({ assert }) => {
    const zonas = [CALI, POPAYAN, { ...POPAYAN, nombre: 'Inactiva', activa: false }]
      .map(normalizarZona)
      .filter((z): z is Zona => z !== null)
    assert.equal(CoverageService.zonaDeEn(zonas, 2.44, -76.61)?.clave, 'popayan')
    assert.equal(CoverageService.zonaDeEn(zonas, 3.45, -76.53)?.clave, 'cali')
    assert.isNull(CoverageService.zonaDeEn(zonas, 4.6, -74.08)) // Bogotá
  })
})
