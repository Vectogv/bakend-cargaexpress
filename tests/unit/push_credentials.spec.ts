import { test } from '@japa/runner'
import { leerCredenciales } from '#services/push_notification_service'

/**
 * Credenciales de Firebase para las notificaciones push.
 *
 * En Railway no se puede dejar un archivo en el disco, así que además de
 * FIREBASE_CREDENTIALS_PATH se acepta el JSON completo en
 * FIREBASE_CREDENTIALS_JSON, en texto o en base64.
 */

const CUENTA = {
  type: 'service_account',
  project_id: 'app-cargaexpress',
  private_key_id: 'abc123',
  private_key: '-----BEGIN PRIVATE KEY-----\nMIIBOgIB\n-----END PRIVATE KEY-----\n',
  client_email: 'firebase-adminsdk-xxxxx@app-cargaexpress.iam.gserviceaccount.com',
}

// Configuración de la app Android: NO sirve para el servidor.
const GOOGLE_SERVICES = {
  project_info: { project_number: '848686850284', project_id: 'app-cargaexpress' },
  client: [{ client_info: { mobilesdk_app_id: '1:848686850284:android:abc' } }],
  configuration_version: '1',
}

test.group('Unit - credenciales de Firebase', () => {
  test('sin variables devuelve null (push desactivado, sin error)', ({ assert }) => {
    assert.isNull(leerCredenciales({}))
  })

  test('acepta el JSON en texto plano', ({ assert }) => {
    const r = leerCredenciales({ json: JSON.stringify(CUENTA) })
    assert.notStrictEqual(r, null)
    if (r && 'cuenta' in r) {
      assert.equal(r.cuenta.project_id, 'app-cargaexpress')
      assert.equal(r.cuenta.client_email, CUENTA.client_email)
    } else {
      assert.fail('debería devolver la cuenta')
    }
  })

  test('acepta el JSON en base64', ({ assert }) => {
    const b64 = Buffer.from(JSON.stringify(CUENTA), 'utf8').toString('base64')
    const r = leerCredenciales({ json: b64 })
    if (r && 'cuenta' in r) assert.equal(r.cuenta.project_id, 'app-cargaexpress')
    else assert.fail('debería aceptar base64')
  })

  test('convierte los \\n literales de la clave privada en saltos de línea', ({ assert }) => {
    // Al pegar la clave en una variable de entorno suele quedar así, y
    // firebase-admin la rechaza sin este arreglo.
    const conLiterales = { ...CUENTA, private_key: '-----BEGIN PRIVATE KEY-----\\nMIIBOgIB\\n-----END PRIVATE KEY-----\\n' }
    const r = leerCredenciales({ json: JSON.stringify(conLiterales) })
    if (r && 'cuenta' in r) {
      assert.notInclude(r.cuenta.private_key, '\\n')
      assert.include(r.cuenta.private_key, '\n')
    } else {
      assert.fail('debería devolver la cuenta')
    }
  })

  test('rechaza google-services.json con un mensaje que explica el error', ({ assert }) => {
    const r = leerCredenciales({ json: JSON.stringify(GOOGLE_SERVICES) })
    assert.isTrue(r !== null && 'error' in r)
    if (r && 'error' in r) assert.include(r.error, 'project_id')
  })

  test('rechaza una cuenta de otro tipo avisando de google-services.json', ({ assert }) => {
    const r = leerCredenciales({ json: JSON.stringify({ type: 'authorized_user', project_id: 'x' }) })
    if (r && 'error' in r) assert.include(r.error, 'cuenta de servicio')
    else assert.fail('debería rechazarlo')
  })

  test('rechaza texto que no es JSON ni base64 válido', ({ assert }) => {
    const r = leerCredenciales({ json: 'esto no es nada' })
    assert.isTrue(r !== null && 'error' in r)
  })

  test('rechaza una cuenta sin private_key', ({ assert }) => {
    const { private_key: _omitida, ...sinClave } = CUENTA
    const r = leerCredenciales({ json: JSON.stringify(sinClave) })
    if (r && 'error' in r) assert.include(r.error, 'private_key')
    else assert.fail('debería rechazarlo')
  })

  test('sigue funcionando la ruta a un archivo', ({ assert }) => {
    const r = leerCredenciales({ path: '/ruta/cuenta.json' }, () => CUENTA)
    if (r && 'cuenta' in r) assert.equal(r.cuenta.project_id, 'app-cargaexpress')
    else assert.fail('debería leer el archivo')
  })

  test('informa si la ruta no se puede leer', ({ assert }) => {
    const r = leerCredenciales({ path: '/no/existe.json' }, () => { throw new Error('no such file') })
    if (r && 'error' in r) assert.include(r.error, 'FIREBASE_CREDENTIALS_PATH')
    else assert.fail('debería avisar del error')
  })

  test('el JSON tiene prioridad sobre la ruta', ({ assert }) => {
    const otra = { ...CUENTA, project_id: 'desde-el-json' }
    const r = leerCredenciales({ json: JSON.stringify(otra), path: '/ruta/cuenta.json' }, () => CUENTA)
    if (r && 'cuenta' in r) assert.equal(r.cuenta.project_id, 'desde-el-json')
    else assert.fail('debería preferir el JSON')
  })
})
