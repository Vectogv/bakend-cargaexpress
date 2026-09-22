import { test } from '@japa/runner'
import app from '@adonisjs/core/services/app'

test.group('Unit - sanity', () => {
  test('la app arranca en entorno de test', ({ assert }) => {
    assert.equal(app.getEnvironment(), 'test')
    assert.isTrue(app.inTest)
  })
})
