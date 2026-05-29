import { BaseSeeder } from '@adonisjs/lucid/seeders'
import db from '@adonisjs/lucid/services/db'

export default class extends BaseSeeder {
  async run() {
    const exists = await db.from('users').where('email', 'admin@gmail.com').first()
    if (exists) {
      console.log('Admin user already exists, skipping.')
      return
    }

    await db.table('users').insert({
      nombre: 'Admin',
      apellido: 'CargaExpress',
      email: 'admin@gmail.com',
      password: '123456',
      rol: 'admin',
      telefono: null,
      edad: null,
      full_name: null,
      avatar: null,
      created_at: new Date(),
      updated_at: new Date(),
    })

    console.log('Admin user created: admin@gmail.com / 123456')
  }
}
