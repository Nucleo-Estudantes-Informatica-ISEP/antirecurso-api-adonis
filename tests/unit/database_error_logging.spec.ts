import { createRequire } from 'node:module'
import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { captureLogger } from '#tests/helpers/capture_logger'

const { DatabaseError } = createRequire(import.meta.url)('pg')

const SECRET = 'comentario-privado-do-utilizador'

function failingConnection(failure: Error) {
  return {
    query: (_config: unknown, callback: (error: Error) => void) => callback(failure),
  }
}

function databaseError() {
  const failure = new DatabaseError('duplicate key value violates unique constraint', 0, 'error')
  failure.code = '23505'
  failure.severity = 'ERROR'
  failure.detail = `Key (text)=(${SECRET}) already exists.`
  failure.where = `COPY comments, line 1: "${SECRET}"`
  return failure
}

async function failedQuery(sql: string) {
  const client = (db.connection().getWriteClient() as any).client
  try {
    await client.query(failingConnection(databaseError()), { sql, bindings: [SECRET] })
  } catch (error) {
    return { client, error: error as Error }
  } finally {
    await db.manager.closeAll()
  }
  throw new Error('the query was expected to fail')
}

test.group('Database error logging', () => {
  test('keeps SQL compilation with values disabled on the connection', async ({ assert }) => {
    const { client } = await failedQuery('insert into comments (text) values (?)')

    assert.isFalse(client.config.compileSqlOnError)
  })

  test('failed queries report placeholders instead of submitted values', async ({ assert }) => {
    for (const sql of [
      'insert into comments (text) values (?)',
      'insert into comments (text) values ($1)',
    ]) {
      const { error } = await failedQuery(sql)

      assert.notInclude(error.message, SECRET)
      assert.include(error.message, '$1')
    }
  })

  test('a logged database failure never contains the submitted values', async ({ assert }) => {
    const { error } = await failedQuery('insert into comments (text) values (?)')
    const { instance, lines } = captureLogger()

    instance.error({ err: error }, error.message)

    const output = lines.join('')
    assert.notInclude(output, SECRET)
    assert.include(output, '23505')
  })

  test('masks PostgreSQL input echoed in message, stack, cause and top-level msg', ({ assert }) => {
    const error = databaseError()
    error.code = '22P02'
    error.message = `invalid input syntax for type integer: "${SECRET}"`
    error.stack = `error: ${error.message}\n    at database.query`
    error.cause = new Error(`query binding: ${SECRET}`)
    const { instance, lines } = captureLogger()

    instance.error(
      { err: error, request_id: 'request-test-123', route: '/subjects/:id' },
      error.message
    )

    const output = lines.join('')
    assert.notInclude(output, SECRET)
    const entry = JSON.parse(output)
    assert.equal(entry.err.code, '22P02')
    assert.equal(entry.msg, 'database operation failed')
    assert.equal(entry.request_id, 'request-test-123')
    assert.equal(entry.route, '/subjects/:id')
    assert.include(error.message, SECRET)
  })

  test('keeps message and stack of non-PostgreSQL errors with five-character codes', ({
    assert,
  }) => {
    for (const code of ['EPIPE', 'EPERM', 'EBUSY', 'EXDEV']) {
      const error = Object.assign(new Error(`write failed with ${code}`), { code })
      const { instance, lines } = captureLogger()

      instance.error({ err: error }, error.message)

      const entry = JSON.parse(lines.join(''))
      assert.equal(entry.msg, `write failed with ${code}`)
      assert.equal(entry.err.code, code)
      assert.equal(entry.err.type, 'Error')
      assert.include(entry.err.stack, code)
    }
  })
})
