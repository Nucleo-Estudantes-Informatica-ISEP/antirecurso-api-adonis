import { test } from '@japa/runner'
import { getUserAvatar, serializeUserIdentity } from '#services/auth/user_identity'
import type { AuthClaims } from '#services/auth/zitadel_auth_service'

const localUser = { id: 7, name: 'Stale name', email: 'stale@example.com' }

test.group('AuthNEI user identity', () => {
  test('uses current claims and AuthNEI picture for authenticated responses', ({ assert }) => {
    const claims = {
      sub: 'authnei-subject',
      name: 'Current name',
      email: 'current@example.com',
      picture: 'https://authnei.example/avatar.png',
      authNeiRoles: ['admin'],
    } as AuthClaims

    assert.deepEqual(serializeUserIdentity(localUser, claims), {
      id: 7,
      name: 'Current name',
      email: 'current@example.com',
      avatar: 'https://authnei.example/avatar.png',
      is_admin: true,
    })
  })

  test('uses normalized email Gravatar hash for cached identities', ({ assert }) => {
    assert.equal(getUserAvatar('  USER@example.com  '), 'b58996c504c5638798eb6b511e6f49af')
    assert.deepEqual(serializeUserIdentity(localUser), {
      id: 7,
      name: 'Stale name',
      email: 'stale@example.com',
      avatar: 'e0b1c0d565d977edda3123eae01fc4ad',
    })
  })
})
