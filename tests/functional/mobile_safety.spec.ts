import { test } from '@japa/runner'
import { randomUUID } from 'node:crypto'
import db from '@adonisjs/lucid/services/db'
import User from '#models/user'
import Subject from '#models/subject'
import QuestionType from '#models/question_type'
import Question from '#models/question'
import Option from '#models/option'
import Comment from '#models/comment'
import Answer from '#models/answer'
import AnswerQuestion from '#models/answer_question'
import Note from '#models/note'
import StorageService from '#services/storage_service'
import { withNoteMutation } from '#services/note_mutation'
import { deleteAccount } from '#services/auth/account_deletion'
import env from '#start/env'
import { signUploadAccess } from '#services/uploads/signed_note_access'
import ZitadelAuthService from '#services/auth/zitadel_auth_service'
import {
  createOidcFixture,
  installFetchMock,
  userPayload,
  adminPayload,
} from '#tests/helpers/token_factory'

test.group('Mobile account deletion and comment safety', (group) => {
  let fixture: Awaited<ReturnType<typeof createOidcFixture>>
  let restoreFetch: () => void
  const subjects: number[] = []
  const identities: string[] = []

  group.setup(async () => {
    ZitadelAuthService.clearCachesForTests()
    fixture = await createOidcFixture()
    restoreFetch = installFetchMock(fixture.jwk)
  })
  group.teardown(async () => {
    restoreFetch()
    ZitadelAuthService.clearCachesForTests()
    await Subject.query().whereIn('id', subjects).delete()
    await User.query().whereIn('authSubject', identities).delete()
  })

  async function setup() {
    const id = randomUUID()
    const actors = await Promise.all(
      ['viewer', 'author', 'admin'].map(async (role) => {
        const sub = `safety-${role}-${id}`
        identities.push(sub)
        const email = `${sub}@example.test`
        const user = await User.create({ authSubject: sub, email, name: role })
        const claims = role === 'admin' ? adminPayload(sub, email) : userPayload(sub, email)
        return { user, token: await fixture.sign(claims), sub, email }
      })
    )
    const [viewer, author, admin] = actors
    const subject = await Subject.create({ name: id, slug: id, year: 1 })
    subjects.push(subject.id)
    const type = await QuestionType.create({ name: 'MC', subjectId: subject.id })
    const question = await Question.create({
      question: 'Safety?',
      correctOption: 'A',
      exam: '',
      image: '',
      subjectId: subject.id,
      questionTypeId: type.id,
    })
    const option = await Option.create({ name: 'Yes', order: 'A', questionId: question.id })
    const comment = await Comment.create({
      comment: 'Student discussion',
      userId: author.user.id,
      questionId: question.id,
    })
    const answer = await Answer.create({
      userId: viewer.user.id,
      subjectId: subject.id,
      score: 100,
      mode: 'default',
      time: 1,
    })
    await AnswerQuestion.create({
      answerId: answer.id,
      questionId: question.id,
      optionId: option.id,
      isWrong: false,
    })
    return { viewer, author, admin, subject, question, comment, answer }
  }

  test('safety mutations require authentication and confirmed self deletion', async ({
    client,
  }) => {
    for (const path of ['/user', '/user/blocks/1']) {
      const res = await client.delete(path)
      res.assertStatus(401)
    }
    const report = await client.post('/comments/1/report').json({ reason: 'Abuse' })
    report.assertStatus(401)
    const { viewer } = await setup()
    const res = await client
      .delete('/user')
      .header('authorization', `Bearer ${viewer.token}`)
      .json({})
    res.assertStatus(422)
  })

  test('blocking filters every comment read for only the viewer and can be undone', async ({
    client,
    assert,
  }) => {
    const { viewer, author, comment, answer } = await setup()
    const auth = `Bearer ${viewer.token}`
    const self = await client.put(`/user/blocks/${viewer.user.id}`).header('authorization', auth)
    self.assertStatus(422)
    const unknown = await client.put('/user/blocks/999999999').header('authorization', auth)
    unknown.assertStatus(404)
    const blocked = await client.put(`/user/blocks/${author.user.id}`).header('authorization', auth)
    blocked.assertStatus(204)
    const duplicate = await client
      .put(`/user/blocks/${author.user.id}`)
      .header('authorization', auth)
    duplicate.assertStatus(204)
    const hidden = await client.get(`/comments/${comment.id}`).header('authorization', auth)
    hidden.assertStatus(404)
    const index = await client.get('/comments?per_page=100').header('authorization', auth)
    index.assertStatus(200)
    assert.isFalse(index.body().data.some((item: { id: number }) => item.id === comment.id))
    const review = await client.get(`/exams/${answer.id}`).header('authorization', auth)
    review.assertStatus(200)
    assert.deepEqual(review.body().questions[0].comments, [])
    const otherViewer = await client
      .get(`/comments/${comment.id}`)
      .header('authorization', `Bearer ${author.token}`)
    otherViewer.assertStatus(200)
    assert.equal(otherViewer.body().user_id, author.user.id)
    const list = await client.get('/user/blocks').header('authorization', auth)
    list.assertStatus(200)
    assert.equal(list.body().data[0].id, author.user.id)
    const clear = await client
      .delete(`/user/blocks/${author.user.id}`)
      .header('authorization', auth)
    clear.assertStatus(204)
    const visible = await client.get(`/comments/${comment.id}`).header('authorization', auth)
    visible.assertStatus(200)
  })

  test('reports deduplicate and only admins can moderate; removal covers nested review', async ({
    client,
    assert,
  }) => {
    const { viewer, author, admin, comment, answer } = await setup()
    const auth = `Bearer ${viewer.token}`
    const first = await client
      .post(`/comments/${comment.id}/report`)
      .header('authorization', auth)
      .json({ reason: 'Harassment', user_id: author.user.id })
    first.assertStatus(201)
    const duplicate = await client
      .post(`/comments/${comment.id}/report`)
      .header('authorization', auth)
      .json({ reason: 'Harassment' })
    duplicate.assertStatus(200)
    assert.equal(first.body().id, duplicate.body().id)
    const forbidden = await client.get('/comment-reports').header('authorization', auth)
    forbidden.assertStatus(403)
    const forbiddenReview = await client
      .post(`/comment-reports/${first.body().id}/review`)
      .header('authorization', auth)
      .json({ action: 'remove' })
    forbiddenReview.assertStatus(403)
    const queue = await client
      .get('/comment-reports')
      .header('authorization', `Bearer ${admin.token}`)
    queue.assertStatus(200)
    const report = queue.body().data.find((item: { id: number }) => item.id === first.body().id)
    assert.equal(report.reporter_id, viewer.user.id)
    assert.equal(report.comment.comment, comment.comment)
    const removed = await client
      .post(`/comment-reports/${first.body().id}/review`)
      .header('authorization', `Bearer ${admin.token}`)
      .json({ action: 'remove' })
    removed.assertStatus(204)
    const hidden = await client
      .get(`/comments/${comment.id}`)
      .header('authorization', `Bearer ${author.token}`)
    hidden.assertStatus(404)
    const review = await client.get(`/exams/${answer.id}`).header('authorization', auth)
    review.assertStatus(200)
    assert.deepEqual(review.body().questions[0].comments, [])
  })

  test('dismissal retains content; report validation and reviewer identity remain server-owned', async ({
    client,
    assert,
  }) => {
    const { viewer, admin, comment } = await setup()
    const invalid = await client
      .post(`/comments/${comment.id}/report`)
      .header('authorization', `Bearer ${viewer.token}`)
      .json({ reason: ' ' })
    invalid.assertStatus(422)
    const report = await client
      .post(`/comments/${comment.id}/report`)
      .header('authorization', `Bearer ${viewer.token}`)
      .json({ reason: 'Review this' })
    report.assertStatus(201)
    const reviewed = await client
      .post(`/comment-reports/${report.body().id}/review`)
      .header('authorization', `Bearer ${admin.token}`)
      .json({ action: 'dismiss', reviewer_id: viewer.user.id })
    reviewed.assertStatus(204)
    const visible = await client
      .get(`/comments/${comment.id}`)
      .header('authorization', `Bearer ${viewer.token}`)
    visible.assertStatus(200)
    const row = await db.from('comment_reports').where('id', report.body().id).first()
    assert.equal(row.reviewed_by, admin.user.id)
    assert.equal(row.status, 'dismissed')
  })

  test('deletion removes owned app data, preserves other users, and rejects old tokens', async ({
    client,
    assert,
  }) => {
    const { viewer, author, subject, question, answer } = await setup()
    await Comment.create({
      comment: 'Own content',
      userId: viewer.user.id,
      questionId: question.id,
    })
    await db.table('scores').insert({
      score: 100,
      user_id: viewer.user.id,
      subject_id: subject.id,
      created_at: new Date(),
      updated_at: new Date(),
    })
    await db
      .table('exam_states')
      .insert({ state: {}, mode: 'default', user_id: viewer.user.id, subject_id: subject.id })
    const deleted = await client
      .delete('/user')
      .header('authorization', `Bearer ${viewer.token}`)
      .json({ confirmation: 'DELETE_ANTIRECURSO_DATA', user_id: author.user.id })
    deleted.assertStatus(204)
    assert.isNull(await User.find(viewer.user.id))
    assert.isNotNull(await User.find(author.user.id))
    assert.isNull(await Answer.find(answer.id))
    assert.isNull(await Comment.findBy('userId', viewer.user.id))
    assert.isNull(await db.from('scores').where('user_id', viewer.user.id).first())
    assert.isNull(await db.from('exam_states').where('user_id', viewer.user.id).first())
    const stale = await client.get('/user').header('authorization', `Bearer ${viewer.token}`)
    stale.assertStatus(401)
    assert.isNull(await User.findBy('authSubject', viewer.sub))
    const fresh = await fixture.sign(
      userPayload(viewer.sub, viewer.email, { iat: Math.floor(Date.now() / 1000) + 2 })
    )
    const rejoined = await client.get('/user').header('authorization', `Bearer ${fresh}`)
    rejoined.assertStatus(200)
    assert.notEqual(rejoined.body().id, viewer.user.id)
  })

  test('storage failure never reports successful deletion or drops account metadata', async ({
    client,
    assert,
  }) => {
    const { viewer, subject } = await setup()
    const note = await Note.create({
      title: 'Private PDF',
      uploadId: randomUUID(),
      userId: viewer.user.id,
      subjectId: subject.id,
      views: 0,
    })
    const res = await client
      .delete('/user')
      .header('authorization', `Bearer ${viewer.token}`)
      .json({ confirmation: 'DELETE_ANTIRECURSO_DATA' })
    res.assertStatus(503)
    assert.isNotNull(await User.find(viewer.user.id))
    assert.isNotNull(await Note.find(note.id))
  })

  test('deletion cleans owned published and unpromoted files before dropping metadata', async ({
    client,
    assert,
  }) => {
    const { viewer, subject } = await setup()
    const published = randomUUID()
    const pending = randomUUID()
    await Note.create({
      title: 'Own note',
      uploadId: published,
      userId: viewer.user.id,
      subjectId: subject.id,
      views: 0,
    })
    await db
      .table('note_uploads')
      .insert({ id: pending, user_id: viewer.user.id, created_at: new Date() })
    const original = StorageService.prototype.deleteNoteAssets
    const removed: string[] = []
    StorageService.prototype.deleteNoteAssets = async (id) => {
      removed.push(id)
    }
    try {
      const res = await client
        .delete('/user')
        .header('authorization', `Bearer ${viewer.token}`)
        .json({ confirmation: 'DELETE_ANTIRECURSO_DATA' })
      res.assertStatus(204)
      assert.sameMembers(removed, [published, pending])
      assert.isNull(await db.from('note_uploads').where('id', pending).first())
    } finally {
      StorageService.prototype.deleteNoteAssets = original
    }
  })

  test('upload capability requires its authenticated owner, including before storage access', async ({
    client,
  }) => {
    const { viewer, author } = await setup()
    const id = randomUUID()
    const expires = Date.now() + 60000
    const signature = signUploadAccess(env.get('APP_KEY'), id, expires)
    await db.table('note_uploads').insert({ id, user_id: viewer.user.id, created_at: new Date() })
    const other = await client
      .put(`/uploads/${id}?expires=${expires}&signature=${signature}`)
      .header('authorization', `Bearer ${author.token}`)
      .header('content-type', 'application/pdf')
    other.assertStatus(403)
    const owner = await client
      .put(`/uploads/${id}?expires=${expires}&signature=${signature}`)
      .header('authorization', `Bearer ${viewer.token}`)
      .header('content-type', 'application/pdf')
    owner.assertStatus(503)
  })

  test('deletion preserves files referenced by another account and concurrent deletion cannot recreate it', async ({
    client,
    assert,
  }) => {
    const { viewer, author, subject } = await setup()
    const shared = randomUUID()
    await db
      .table('note_uploads')
      .insert({ id: shared, user_id: viewer.user.id, created_at: new Date() })
    const note = await Note.create({
      title: 'Shared legacy file',
      uploadId: shared,
      userId: author.user.id,
      subjectId: subject.id,
      views: 0,
    })
    const conflict = await client
      .delete('/user')
      .header('authorization', `Bearer ${viewer.token}`)
      .json({ confirmation: 'DELETE_ANTIRECURSO_DATA' })
    conflict.assertStatus(409)
    assert.isNotNull(await User.find(viewer.user.id))
    await db.from('note_uploads').where('id', shared).delete()
    const requests = await Promise.all(
      [0, 1].map(() =>
        client
          .delete('/user')
          .header('authorization', `Bearer ${viewer.token}`)
          .json({ confirmation: 'DELETE_ANTIRECURSO_DATA' })
      )
    )
    assert.sameMembers(
      requests.map((res) => res.status()),
      [204, 401]
    )
    assert.isNull(await User.findBy('authSubject', viewer.sub))
    assert.isNotNull(await Note.find(note.id))
  })
  test('file mutation holds a cross-worker lock and deletion removes the completed upload', async ({
    assert,
  }) => {
    const { viewer } = await setup()
    const id = randomUUID()
    await db.table('note_uploads').insert({ id, user_id: viewer.user.id, created_at: new Date() })
    let entered!: () => void
    let release!: () => void
    const started = new Promise<void>((resolve) => {
      entered = resolve
    })
    const finish = new Promise<void>((resolve) => {
      release = resolve
    })
    let uploaded = false
    const original = StorageService.prototype.deleteNoteAssets
    StorageService.prototype.deleteNoteAssets = async (removed) => {
      assert.equal(removed, id)
      assert.isTrue(uploaded)
    }
    const mutation = withNoteMutation(viewer.user.id, async () => {
      entered()
      await finish
      uploaded = true
    })
    try {
      await started
      const available = await db.transaction(async (trx) => {
        const result = await trx.rawQuery(
          "SELECT pg_try_advisory_xact_lock(hashtext('antirecurso-note-assets')) AS available"
        )
        return result.rows[0].available
      })
      assert.isFalse(available)
      const deletion = deleteAccount(viewer.user.id, viewer.sub)
      release()
      await Promise.all([mutation, deletion])
      assert.isNull(await User.find(viewer.user.id))
      await assert.rejects(
        () =>
          withNoteMutation(viewer.user.id, async () => {
            assert.fail('Deleted actor cannot write assets')
          }),
        /Account no longer available/
      )
    } finally {
      release()
      await mutation
      StorageService.prototype.deleteNoteAssets = original
    }
  })
})
