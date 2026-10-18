import { BaseSeeder } from '@adonisjs/lucid/seeders'

export default class extends BaseSeeder {
  async run() {
    throw new Error(
      'Raw bank publication is disabled. Use questions:import with stable identity and an operator-supplied review note; the importer does not authenticate academic approval.'
    )
  }
}
