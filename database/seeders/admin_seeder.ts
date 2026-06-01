import { BaseSeeder } from '@adonisjs/lucid/seeders'
import db from '@adonisjs/lucid/services/db'
import hash from '@adonisjs/core/services/hash'

export default class extends BaseSeeder {
  async run() {
    const adminExists = await db.from('users').where('email', 'admin@gmail.com').first()
    if (!adminExists) {
      await db.table('users').insert({
        nombre: 'Admin',
        apellido: 'CargaExpress',
        email: 'admin@gmail.com',
        password: await hash.make('123456'),
        rol: 'admin',
        telefono: null,
        edad: null,
        full_name: null,
        avatar: null,
        created_at: new Date(),
        updated_at: new Date(),
      })
      console.log('Admin created: admin@gmail.com / 123456')
    } else if (!adminExists.password.startsWith('$')) {
      await db.from('users').where('email', 'admin@gmail.com').update({ password: await hash.make('123456') })
      console.log('Admin password fixed (was plaintext)')
    } else {
      console.log('Admin already exists, skipping.')
    }

    const conductorExists = await db.from('users').where('email', 'conductor@gmail.com').first()
    if (!conductorExists) {
      await db.table('users').insert({
        nombre: 'Carlos',
        apellido: 'Pérez',
        email: 'conductor@gmail.com',
        password: await hash.make('123456'),
        rol: 'conductor',
        telefono: '3001234567',
        edad: 30,
        full_name: null,
        avatar: null,
        created_at: new Date(),
        updated_at: new Date(),
      })
      console.log('Conductor created: conductor@gmail.com / 123456')
    } else {
      console.log('Conductor already exists, skipping.')
    }

    const clienteExists = await db.from('users').where('email', 'cliente@gmail.com').first()
    if (!clienteExists) {
      await db.table('users').insert({
        nombre: 'María',
        apellido: 'García',
        email: 'cliente@gmail.com',
        password: await hash.make('123456'),
        rol: 'cliente',
        telefono: '3007654321',
        edad: 25,
        full_name: null,
        avatar: null,
        created_at: new Date(),
        updated_at: new Date(),
      })
      console.log('Client created: cliente@gmail.com / 123456')
    } else {
      console.log('Client already exists, skipping.')
    }
  }
}
