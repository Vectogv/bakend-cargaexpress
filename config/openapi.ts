import { defineConfig } from '@foadonis/openapi'

export default defineConfig({
  ui: 'scalar',
  document: {
    info: {
      title: 'Carga Express API',
      version: '1.0.0',
      description: 'API de Carga Express - aplicación de transporte',
    },
  },
})