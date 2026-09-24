import { readFile } from 'node:fs/promises'
import { test } from '@japa/runner'

test('Node type definitions match the production Docker runtime', async ({ assert }) => {
  const dockerfile = await readFile(new URL('../../Dockerfile', import.meta.url), 'utf8')
  const lockfile = JSON.parse(
    await readFile(new URL('../../package-lock.json', import.meta.url), 'utf8')
  )
  const runtimeMajor = dockerfile.match(/^FROM node:(\d+)[^\n]* AS runner$/m)?.[1]
  const typesMajor = lockfile.packages['node_modules/@types/node'].version.split('.')[0]

  assert.isDefined(runtimeMajor)
  assert.equal(typesMajor, runtimeMajor)
})
