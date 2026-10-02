import { test } from '@japa/runner'
import { contieneContacto } from '#services/filtro_contacto'

test.group('Filtro de contacto del chat', () => {
  test('bloquea teléfonos, WhatsApp, Telegram y correos', ({ assert }) => {
    for (const t of [
      'llámame al 3001234567',
      'mi cel 300 123 4567',
      '+57 (300) 123-45-67',
      'escríbeme al whatsapp',
      'por WhatsApp mejor',
      'wasap porfa',
      'wa.me/573001234567',
      'telegram @juan',
      'juan.perez@gmail.com',
    ]) {
      assert.isTrue(contieneContacto(t), t)
    }
  })

  test('deja pasar mensajes normales, precios y direcciones', ({ assert }) => {
    for (const t of [
      'Ya voy llegando',
      'Son $90.000',
      'Calle 5 # 10-20, apto 302',
      'Llego en 15 minutos',
      'Carrera 9 No. 12N-45',
    ]) {
      assert.isFalse(contieneContacto(t), t)
    }
  })
})
