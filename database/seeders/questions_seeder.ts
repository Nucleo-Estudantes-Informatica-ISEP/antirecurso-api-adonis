import { BaseSeeder } from '@adonisjs/lucid/seeders'

export default class extends BaseSeeder {
  async run() {
    throw new Error(
      'Question bank seeding requires academic approval and stable identity. Use questions:import with a reviewed batch; raw banks are candidates only.'
    )
  }
}
