import { Writable } from 'node:stream'
import pino from 'pino'
import { test } from '@japa/runner'
import loggerConfig from '#config/logger'

function captureLogger() {
  const lines: string[] = []
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      lines.push(chunk.toString())
      callback()
    },
  })
  const { redact } = loggerConfig.loggers.app
  const instance = pino({ redact }, stream)
  return { instance, lines }
}

test.group('Logger redaction', () => {
  test('masks credentials at the top level and in nested objects', ({ assert }) => {
    const { instance, lines } = captureLogger()

    instance.info(
      {
        authorization: 'Bearer top-secret',
        password: 'hunter2',
        access_token: 'access-secret',
        refresh_token: 'refresh-secret',
        id_token: 'id-secret',
        body: { password: 'nested-password', token: 'nested-token' },
        req: {
          headers: { authorization: 'Bearer header-secret', cookie: 'session=cookie-secret' },
        },
      },
      'sample'
    )

    const output = lines.join('')
    for (const secret of [
      'top-secret',
      'hunter2',
      'access-secret',
      'refresh-secret',
      'id-secret',
      'nested-password',
      'nested-token',
      'header-secret',
      'cookie-secret',
    ]) {
      assert.notInclude(output, secret)
    }
    assert.include(output, '[redacted]')
  })

  test('masks database error details that can echo submitted values', ({ assert }) => {
    const { instance, lines } = captureLogger()

    instance.error(
      {
        err: {
          message: 'duplicate key value violates unique constraint',
          code: '23505',
          detail: 'Key (email)=(student@isep.ipp.pt) already exists.',
          where: 'COPY users, line 1: "student@isep.ipp.pt"',
        },
      },
      'insert failed'
    )

    const entry = JSON.parse(lines.join(''))
    assert.notInclude(lines.join(''), 'student@isep.ipp.pt')
    assert.equal(entry.err.code, '23505')
    assert.equal(entry.err.message, 'duplicate key value violates unique constraint')
  })

  test('keeps non-sensitive request fields readable', ({ assert }) => {
    const { instance, lines } = captureLogger()

    instance.info({ method: 'GET', route: '/subjects/:id', status: 200, user_id: 7 }, 'ok')

    const entry = JSON.parse(lines.join(''))
    assert.equal(entry.method, 'GET')
    assert.equal(entry.route, '/subjects/:id')
    assert.equal(entry.status, 200)
    assert.equal(entry.user_id, 7)
  })
})
