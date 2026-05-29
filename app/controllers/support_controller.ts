import type { HttpContext } from '@adonisjs/core/http'
import { ApiOperation, ApiResponse } from '@foadonis/openapi/decorators'

export default class SupportController {
  @ApiOperation({ summary: 'Get help info', description: 'Returns FAQ and contact information' })
  @ApiResponse({ type: 'object' })
  async help({ serialize }: HttpContext) {
    return serialize.withoutWrapping({
      faq: [
        {
          pregunta: '¿Cómo me registro?',
          respuesta:
            'Descarga la app y crea una cuenta con tu correo electrónico. Luego verifica tu identidad y ya podrás solicitar o realizar envíos.',
        },
        {
          pregunta: '¿Cómo funciona el pago?',
          respuesta:
            'El pago se realiza en efectivo al completar el servicio. El monto se acuerda antes de iniciar el viaje.',
        },
      ],
      contacto: {
        email: 'soporte@cargaexpress.com',
        telefono: '+58 800-CARGA',
      },
    })
  }

  @ApiOperation({ summary: 'Get emergency numbers', description: 'Returns emergency and support phone numbers' })
  @ApiResponse({ type: 'object' })
  async emergency({ serialize }: HttpContext) {
    return serialize.withoutWrapping({
      numeros: [
        { nombre: 'Emergencias', numero: '911' },
        { nombre: 'Tránsito terrestre', numero: '0800-TRANSITO' },
        { nombre: 'Asistencia vial', numero: '0500-ASISTENCIA' },
        { nombre: 'Soporte CargaExpress', numero: '+58 800-CARGA' },
      ],
    })
  }
}
