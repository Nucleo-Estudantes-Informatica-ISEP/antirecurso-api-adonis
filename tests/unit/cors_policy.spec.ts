import { test } from '@japa/runner'
import { parseAllowedOrigins, resolveAllowedOrigin } from '#services/cors_policy'

test.group('CORS policy', () => {
  test('matches only normalized configured origins', ({ assert }) => {
    const allowed = parseAllowedOrigins('https://antirecurso.nei-isep.org/, http://localhost:3000')

    assert.equal(
      resolveAllowedOrigin('https://antirecurso.nei-isep.org', allowed),
      'https://antirecurso.nei-isep.org'
    )
    assert.equal(resolveAllowedOrigin('http://localhost:3000/', allowed), 'http://localhost:3000')
    assert.isNull(resolveAllowedOrigin('https://attacker.example', allowed))
  })

  test('does not add browser CORS headers to requests without an origin', ({ assert }) => {
    assert.isNull(resolveAllowedOrigin(undefined, parseAllowedOrigins('https://example.test')))
  })
})
