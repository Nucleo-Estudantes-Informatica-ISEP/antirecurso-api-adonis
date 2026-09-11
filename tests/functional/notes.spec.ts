import { test } from '@japa/runner'
import { randomUUID } from 'node:crypto'
import { DateTime } from 'luxon'
import ZitadelAuthService from '#services/auth/zitadel_auth_service'
import Subject from '#models/subject'
import Note from '#models/note'
import User from '#models/user'
import { createOidcFixture, installFetchMock, userPayload, OIDC_TEST_SENTINEL } from '#tests/helpers/token_factory'

test.group('Notes', (group) => {
  const suffix = randomUUID().slice(0, 8)
  const USER_SUB = `notes-user-${suffix}`
  const USER_EMAIL = `notes-user-${suffix}@example.test`

  let userToken: string
  let restoreFetch: () => void
  let subject: Subject
  let note: Note
  let seedUser: User

  group.setup(async () => {
    ZitadelAuthService.clearCachesForTests()
    const fixture = await createOidcFixture()
    restoreFetch = installFetchMock(fixture.jwk)
    userToken = await fixture.sign(userPayload(USER_SUB, USER_EMAIL))

    subject = await Subject.create({
      name: `Notes Subject ${suffix}`,
      slug: `notes-subject-${suffix}`,
      year: 2,
    })

    seedUser = await User.create({
      authSubject: USER_SUB,
      email: USER_EMAIL,
      name: 'Notes Test User',
      emailVerifiedAt: DateTime.now(),
      password: OIDC_TEST_SENTINEL,
      isAdmin: false,
      rememberToken: null,
    })

    note = await Note.create({
      title: `Test Note ${suffix}`,
      url: 'https://example.com/test.pdf',
      description: 'A test note',
      views: 0,
      nPages: null,
      uploadId: null,
      userId: seedUser.id,
      subjectId: subject.id,
    })
  })

  group.teardown(async () => {
    restoreFetch()
    ZitadelAuthService.clearCachesForTests()
    await note.delete()
    await seedUser.delete()
    await subject.delete()
  })

  // --- Listing (public / optional auth) ---

  test('GET /subjects/:id/notes without token returns list', async ({ client, assert }) => {
    const res = await client.get(`/subjects/${subject.id}/notes`)
    res.assertStatus(200)
    assert.isArray(res.body().data)
  })

  test('GET /subjects/:id/notes with unknown subject returns 404', async ({ client }) => {
    const res = await client.get('/subjects/999999/notes')
    res.assertStatus(404)
  })

  test('GET /notes/:id returns note details', async ({ client }) => {
    const res = await client.get(`/notes/${note.id}`)
    res.assertStatus(200)
    res.assertBodyContains({ id: note.id, title: note.title })
  })

  test('GET /notes/:id with unknown id returns 404', async ({ client }) => {
    const res = await client.get('/notes/999999')
    res.assertStatus(404)
  })

  // --- View tracking (auth required) ---

  test('POST /notes/:id/view without token returns 401', async ({ client }) => {
    const res = await client.post(`/notes/${note.id}/view`)
    res.assertStatus(401)
  })

  test('POST /notes/:id/view with token increments view count', async ({ client, assert }) => {
    await note.refresh()
    const before = note.views

    const res = await client
      .post(`/notes/${note.id}/view`)
      .header('authorization', `Bearer ${userToken}`)
    res.assertStatus(200)
    res.assertBodyContains({ url: 'https://example.com/test.pdf' })

    await note.refresh()
    assert.equal(note.views, before + 1)
  })

  test('POST /notes/:id/view with unknown note returns 404', async ({ client }) => {
    const res = await client
      .post('/notes/999999/view')
      .header('authorization', `Bearer ${userToken}`)
    res.assertStatus(404)
  })

  // --- Like (auth required) ---

  test('POST /notes/:id/like without token returns 401', async ({ client }) => {
    const res = await client.post(`/notes/${note.id}/like`)
    res.assertStatus(401)
  })

  test('POST /notes/:id/like with token toggles like', async ({ client }) => {
    const res = await client
      .post(`/notes/${note.id}/like`)
      .header('authorization', `Bearer ${userToken}`)
    res.assertStatus(200)
  })
})
