import { BaseSeeder } from '@adonisjs/lucid/seeders'
import env from '#start/env'

export default class extends BaseSeeder {
  async run() {
    // db:seed uses the synthetic fixture seeder locally; AI banks remain unpublished.
    if (['development', 'test'].includes(env.get('NODE_ENV'))) return
    throw new Error(
      'Raw bank publication is disabled. Use questions:import with stable identity and an operator-supplied review note; the importer does not authenticate academic approval.'
    )
  }
}
