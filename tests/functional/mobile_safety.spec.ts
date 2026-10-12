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
import { lockNoteMutations, withNoteMutation } from '#services/note_mutation'
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
    const { viewer, author, comment, answer, subject, question } = await setup()
    const attemptsTable = await db.rawQuery("SELECT to_regclass('exam_attempts') AS name")
    if (attemptsTable.rows[0].name) {
      const options = await Option.query().where('questionId', question.id)
      await db.table('exam_attempts').insert({
        id: randomUUID(),
        user_id: viewer.user.id,
        subject_id: subject.id,
        mode: 'default',
        snapshot: JSON.stringify({
          nOfQuestions: null,
          penalizingFactor: null,
          questions: [
            {
              id: question.id,
              question: 'Immutable safety review',
              correctOption: 'A',
              question_type: 'MC',
              exam: '',
              image: '',
              options: options.map((option) => ({
                id: option.id,
                name: option.name,
                order: option.order,
              })),
            },
          ],
        }),
        result: JSON.stringify({
          id: answer.id,
          score: 100,
          wrong_answers: 0,
          passed: true,
          subject: subject.name,
        }),
        created_at: new Date(),
        updated_at: new Date(),
      })
    }
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
    if (attemptsTable.rows[0].name)
      assert.equal(review.body().questions[0].question.question, 'Immutable safety review')
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

    const otherNote = await Note.create({
      title: 'Other account',
      userId: author.user.id,
      subjectId: subject.id,
    })
    await Note.create({ title: 'Owned row', userId: viewer.user.id, subjectId: subject.id })
    await db.table('likes').insert({
      user_id: viewer.user.id,
      note_id: otherNote.id,
      created_at: new Date(),
      updated_at: new Date(),
    })
    await db.table('question_reports').insert({
      user_id: viewer.user.id,
      question_id: question.id,
      reason: 'Report',
      created_at: new Date(),
      updated_at: new Date(),
    })
    const otherComment = await Comment.findByOrFail('userId', author.user.id)
    await db.table('comment_reports').insert({
      reporter_id: viewer.user.id,
      comment_id: otherComment.id,
      reason: 'Report',
      created_at: new Date(),
    })
    await db.table('user_blocks').insert([
      { user_id: viewer.user.id, blocked_user_id: author.user.id },
      { user_id: author.user.id, blocked_user_id: viewer.user.id },
    ])
    const attemptsTable = await db.rawQuery("SELECT to_regclass('exam_attempts') AS name")
    if (attemptsTable.rows[0].name) {
      await db.table('exam_attempts').insert({
        id: randomUUID(),
        user_id: viewer.user.id,
        subject_id: subject.id,
        mode: 'default',
        snapshot: JSON.stringify({ questions: [], nOfQuestions: null, penalizingFactor: null }),
        created_at: new Date(),
        updated_at: new Date(),
      })
    }
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

    for (const [table, column] of [
      ['comments', 'user_id'],
      ['likes', 'user_id'],
      ['question_reports', 'user_id'],
      ['comment_reports', 'reporter_id'],
      ['notes', 'user_id'],
      ['user_blocks', 'user_id'],
      ['user_blocks', 'blocked_user_id'],
    ])
      assert.isNull(await db.from(table).where(column, viewer.user.id).first())
    assert.isNull(await AnswerQuestion.findBy('answerId', answer.id))
    assert.isNotNull(await Note.find(otherNote.id))
    if (attemptsTable.rows[0].name)
      assert.isNull(await db.from('exam_attempts').where('user_id', viewer.user.id).first())
    const stale = await client.get('/user').header('authorization', `Bearer ${viewer.token}`)
    stale.assertStatus(401)
    assert.isNull(await User.findBy('authSubject', viewer.sub))
    const fresh = await fixture.sign(
      userPayload(viewer.sub, viewer.email, { iat: Math.floor(Date.now() / 1000) + 2 })
    )
    const rejoined = await client.get('/user').header('authorization', `Bearer ${fresh}`)
    rejoined.assertStatus(200)
    assert.notEqual(rejoined.body().id, viewer.user.id)
    const rejectedAfterRejoin = await client
      .get('/user')
      .header('authorization', `Bearer ${viewer.token}`)
    rejectedAfterRejoin.assertStatus(401)
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

  test('deletion cleans owned published and unpromoted files within the metadata transaction', async ({
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
    const mutation = withNoteMutation(viewer.user.id, async (trx) => {
      await lockNoteMutations(trx, [id])
      entered()
      await finish
      uploaded = true
    })
    try {
      await started
      const available = await db.transaction(async (trx) => {
        const result = await trx.rawQuery(
          'SELECT pg_try_advisory_xact_lock(hashtext(?)) AS available',
          [`antirecurso-note-asset:${id}`]
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
  test('authors cannot report their own comments', async ({ client, assert }) => {
    const { author, comment } = await setup()
    const res = await client
      .post(`/comments/${comment.id}/report`)
      .header('authorization', `Bearer ${author.token}`)
      .json({ reason: 'Own comment' })
    res.assertStatus(422)
    assert.isNull(await db.from('comment_reports').where('comment_id', comment.id).first())
  })

  test('note creation and replacement reject another account upload before storage access', async ({
    client,
    assert,
  }) => {
    const { viewer, admin, subject } = await setup()
    const id = randomUUID()
    await db.table('note_uploads').insert({ id, user_id: viewer.user.id, created_at: new Date() })
    const note = await Note.create({
      title: 'Original',
      userId: admin.user.id,
      subjectId: subject.id,
    })
    const original = StorageService.prototype.promoteUploadedNote
    let promoted = false
    StorageService.prototype.promoteUploadedNote = async () => {
      promoted = true
    }
    try {
      const created = await client
        .post(`/subjects/${subject.id}/notes`)
        .header('authorization', `Bearer ${admin.token}`)
        .json({ title: 'Stolen', upload_id: id })
      created.assertStatus(403)
      const updated = await client
        .patch(`/notes/${note.id}`)
        .header('authorization', `Bearer ${admin.token}`)
        .json({ upload_id: id })
      updated.assertStatus(403)
      assert.isFalse(promoted)
      const unchanged = await Note.findOrFail(note.id)
      assert.isNull(unchanged.uploadId)
    } finally {
      StorageService.prototype.promoteUploadedNote = original
    }
  })

  test('resolved auth reads stay transaction-free', async ({ client, assert }) => {
    const { viewer } = await setup()
    const initial = await client.get('/user').header('authorization', `Bearer ${viewer.token}`)
    initial.assertStatus(200)
    const original = db.transaction
    db.transaction = (() => {
      throw new Error('Unexpected auth transaction')
    }) as typeof db.transaction
    try {
      const repeat = await client.get('/user').header('authorization', `Bearer ${viewer.token}`)
      repeat.assertStatus(200)
      assert.equal(repeat.body().id, viewer.user.id)
    } finally {
      db.transaction = original
    }
  })

  test('blocking an author concurrently deleted returns 404', async ({ client }) => {
    const { viewer, author } = await setup()
    const original = User.find
    User.find = (async (id: number) => {
      const user = await original.call(User, id)
      if (id === author.user.id) await User.query().where('id', id).delete()
      return user
    }) as typeof User.find
    try {
      const res = await client
        .put(`/user/blocks/${author.user.id}`)
        .header('authorization', `Bearer ${viewer.token}`)
      res.assertStatus(404)
    } finally {
      User.find = original
    }
  })

  test('SQL deletion failure rolls back metadata before touching storage', async ({ assert }) => {
    const { viewer, subject } = await setup()
    const note = await Note.create({
      title: 'Retained',
      uploadId: randomUUID(),
      userId: viewer.user.id,
      subjectId: subject.id,
    })
    const originalDelete = User.prototype.delete
    const originalStorage = StorageService.prototype.deleteNoteAssets
    let removed = false
    User.prototype.delete = async () => {
      throw new Error('Injected SQL failure')
    }
    StorageService.prototype.deleteNoteAssets = async () => {
      removed = true
    }
    try {
      await assert.rejects(() => deleteAccount(viewer.user.id, viewer.sub), /Injected SQL failure/)
      assert.isFalse(removed)
      assert.isNotNull(await User.find(viewer.user.id))
      assert.isNotNull(await Note.find(note.id))
    } finally {
      User.prototype.delete = originalDelete
      StorageService.prototype.deleteNoteAssets = originalStorage
    }
  })
  test('deletion accepts explicit confirmation header without a DELETE body', async ({
    client,
    assert,
  }) => {
    const { viewer } = await setup()
    const res = await client
      .delete('/user')
      .header('authorization', `Bearer ${viewer.token}`)
      .header('x-antirecurso-confirmation', 'DELETE_ANTIRECURSO_DATA')
    res.assertStatus(204)
    assert.isNull(await User.find(viewer.user.id))
  })

  test('slow upload body reserves no actor or asset lock and deletion prevents the late write', async ({
    client,
    assert,
  }) => {
    const { viewer, author } = await setup()
    const id = randomUUID()
    const expires = Date.now() + 60000
    const signature = signUploadAccess(env.get('APP_KEY'), id, expires)
    await db.table('note_uploads').insert({ id, user_id: viewer.user.id, created_at: new Date() })
    const originalRead = StorageService.prototype.readNoteUpload
    const originalUpload = StorageService.prototype.uploadNote
    const originalDelete = StorageService.prototype.deleteNoteAssets
    let reads = 0
    let writes = 0
    StorageService.prototype.readNoteUpload = async () => {
      reads++
      await db.transaction(async (trx) => {
        await trx.rawQuery("SET LOCAL lock_timeout = '1s'")
        await trx.from('users').where('id', viewer.user.id).forUpdate().first()
        const result = await trx.rawQuery(
          'SELECT pg_try_advisory_xact_lock(hashtext(?)) AS available',
          [`antirecurso-note-asset:${id}`]
        )
        assert.isTrue(result.rows[0].available)
      })
      await withNoteMutation(author.user.id, async () => {})
      await deleteAccount(viewer.user.id, viewer.sub)
      return Buffer.from('%PDF-test')
    }
    StorageService.prototype.uploadNote = async () => {
      writes++
    }
    StorageService.prototype.deleteNoteAssets = async () => {}
    try {
      const res = await client
        .put(`/uploads/${id}?expires=${expires}&signature=${signature}`)
        .header('authorization', `Bearer ${viewer.token}`)
        .header('content-type', 'application/pdf')
      res.assertStatus(401)
      assert.equal(reads, 1)
      assert.equal(writes, 0)
      assert.isNull(await User.find(viewer.user.id))
    } finally {
      StorageService.prototype.readNoteUpload = originalRead
      StorageService.prototype.uploadNote = originalUpload
      StorageService.prototype.deleteNoteAssets = originalDelete
    }
  })

  test('account file cleanup does not block unrelated users or files', async ({ assert }) => {
    const { viewer, author } = await setup()
    const id = randomUUID()
    await db.table('note_uploads').insert({ id, user_id: viewer.user.id, created_at: new Date() })
    const original = StorageService.prototype.deleteNoteAssets
    StorageService.prototype.deleteNoteAssets = async () => {
      await withNoteMutation(author.user.id, async (trx) => {
        await trx.rawQuery("SET LOCAL lock_timeout = '1s'")
        await lockNoteMutations(trx, [randomUUID()])
      })
    }
    try {
      await deleteAccount(viewer.user.id, viewer.sub)
      assert.isNull(await User.find(viewer.user.id))
      assert.isNotNull(await User.find(author.user.id))
    } finally {
      StorageService.prototype.deleteNoteAssets = original
    }
  })

  test('owned note promotion and replacement work; another admin can still edit metadata', async ({
    client,
    assert,
  }) => {
    const { admin, subject } = await setup()
    const id = randomUUID()
    const replacement = randomUUID()
    await db.table('note_uploads').insert(
      [id, replacement].map((uploadId) => ({
        id: uploadId,
        user_id: admin.user.id,
        created_at: new Date(),
      }))
    )
    const original = StorageService.prototype.promoteUploadedNote
    const promoted: string[] = []
    StorageService.prototype.promoteUploadedNote = async (uploadId) => {
      promoted.push(uploadId)
    }
    try {
      const created = await client
        .post(`/subjects/${subject.id}/notes`)
        .header('authorization', `Bearer ${admin.token}`)
        .json({ title: 'Owned', upload_id: id })
      created.assertStatus(201)
      const updated = await client
        .patch(`/notes/${created.body().id}`)
        .header('authorization', `Bearer ${admin.token}`)
        .json({ upload_id: replacement })
      updated.assertStatus(200)
      assert.equal(updated.body().upload_id, replacement)
      assert.deepEqual(promoted, [id, replacement])
      const otherActors = await setup()
      const other = otherActors.admin
      const edited = await client
        .patch(`/notes/${created.body().id}`)
        .header('authorization', `Bearer ${other.token}`)
        .json({ title: 'Moderated' })
      edited.assertStatus(200)
      assert.equal(edited.body().title, 'Moderated')
      const stolen = await client
        .patch(`/notes/${created.body().id}`)
        .header('authorization', `Bearer ${other.token}`)
        .json({ upload_id: id })
      stolen.assertStatus(403)
    } finally {
      StorageService.prototype.promoteUploadedNote = original
    }
  })
})
