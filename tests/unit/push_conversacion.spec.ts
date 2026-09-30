import { test } from '@japa/runner'
import { armarMensaje } from '#services/push_notification_service'
import {
  debeEnviarPushConversacion,
  PUSH_CONVERSACION_ANTIRREBOTE_MS,
} from '#controllers/conversacion_controller'

test.group('Push de conversaciones agrupado', () => {
  test('armarMensaje con tag lo pone en android.notification y conserva prioridad alta', ({ assert }) => {
    const m = armarMensaje(
      'tok',
      'Moderación CargaExpress',
      'hola',
      { tipo: 'conversacion_mensaje', conversacionId: '7' },
      undefined,
      'conversacion_7'
    )
    assert.equal(m.android.priority, 'high')
    assert.equal(m.android.notification.tag, 'conversacion_7')
    assert.isUndefined(m.android.notification.sound)
    assert.deepEqual(m.data, { tipo: 'conversacion_mensaje', conversacionId: '7' })
    assert.isUndefined(m.apns)
  })

  test('armarMensaje sin tag ni sonido no cambia (otros usos intactos)', ({ assert }) => {
    const m = armarMensaje('tok', 't', 'b', { tipo: 'viaje_estado' })
    assert.deepEqual(m.android, { priority: 'high' })
    const conSonido = armarMensaje('tok', 't', 'b', undefined, 'oferta.mp3')
    assert.deepEqual(conSonido.android, { priority: 'high', notification: { sound: 'oferta.mp3' } })
  })

  test('antirrebote: un push por conversación y destinatario cada 20 s', ({ assert }) => {
    const t0 = 1_000_000
    assert.isTrue(debeEnviarPushConversacion(1, 10, t0))
    assert.isFalse(debeEnviarPushConversacion(1, 10, t0 + 5_000))
    assert.isFalse(debeEnviarPushConversacion(1, 10, t0 + PUSH_CONVERSACION_ANTIRREBOTE_MS - 1))
    // Otro destinatario u otra conversación no se ven afectados.
    assert.isTrue(debeEnviarPushConversacion(1, 11, t0 + 5_000))
    assert.isTrue(debeEnviarPushConversacion(2, 10, t0 + 5_000))
    // Pasados los 20 s vuelve a enviar.
    assert.isTrue(debeEnviarPushConversacion(1, 10, t0 + PUSH_CONVERSACION_ANTIRREBOTE_MS))
  })
})
