import { readFile } from 'node:fs/promises'
import { test } from '@japa/runner'

test.group('AuthNEI production configuration contract', () => {
  test('derives the accepted API audience from the AntiRecurso project id', async ({ assert }) => {
    const compose = await readFile(new URL('../../compose.yml', import.meta.url), 'utf8')
    const envExample = await readFile(new URL('../../.env.example', import.meta.url), 'utf8')

    assert.include(compose, 'AUTH_ALLOWED_AUDIENCES: ${AUTH_ALLOWED_AUDIENCES:-${AUTH_PROJECT_ID}}')
    assert.include(compose, 'AUTH_ISSUER_URL: ${AUTH_ISSUER_URL:-https://auth.nei-isep.org}')
    assert.include(envExample, 'AUTH_ALLOWED_AUDIENCES=replace-with-antirecurso-project-id')
  })
})
