import { test } from '@japa/runner'
import { QUESTION_SOURCES } from '#services/questions/question_source'
import { updateQuestionValidator } from '#validators/question'

const baseBody = {
  correct_option: '1',
  question: 'What is 1 + 1?',
  options: [
    { id: 1, name: 'Two' },
    { id: 2, name: 'Three' },
  ],
}

test.group('Question source', () => {
  test('exposes the controlled set of sources', ({ assert }) => {
    assert.deepEqual([...QUESTION_SOURCES], ['REAL_EXAM', 'AI_GENERATED', 'MANUAL'])
  })

  test('update validator accepts every controlled source', async ({ assert }) => {
    for (const source of QUESTION_SOURCES) {
      const data = await updateQuestionValidator.validate({ ...baseBody, source })
      assert.equal(data.source, source)
    }
  })

  test('update validator keeps source optional', async ({ assert }) => {
    const data = await updateQuestionValidator.validate(baseBody)
    assert.isUndefined(data.source)
  })

  test('update validator rejects values outside the controlled set', async ({ assert }) => {
    for (const source of ['real_exam', 'UNKNOWN', '', 1]) {
      await assert.rejects(() => updateQuestionValidator.validate({ ...baseBody, source }))
    }
  })
})
