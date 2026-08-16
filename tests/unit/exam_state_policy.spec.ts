import { test } from '@japa/runner'
import { InvalidExamStateError, normalizeSavedExamState } from '#services/exams/exam_state_policy'

const validState = {
  version: 2,
  subjectId: 7,
  mode: 'default',
  questionIds: [11, 12, 13],
  answers: [[11, 'a']],
  time: 120,
  currentQuestionIndex: 1,
  ignored: 'not persisted',
}

test.group('Exam state policy', () => {
  test('normalizes the bounded v2 state and strips unknown fields', ({ assert }) => {
    assert.deepEqual(normalizeSavedExamState(validState, 7, 'default'), {
      version: 2,
      subjectId: 7,
      mode: 'default',
      questionIds: [11, 12, 13],
      answers: [[11, 'A']],
      time: 120,
      currentQuestionIndex: 1,
      totalQuestions: 3,
      answered: 1,
    })
  })

  test('rejects identity mismatches and answers outside the generated question set', ({
    assert,
  }) => {
    assert.throws(() => normalizeSavedExamState(validState, 8, 'default'), InvalidExamStateError)
    assert.throws(
      () => normalizeSavedExamState({ ...validState, answers: [[99, 'A']] }, 7, 'default'),
      InvalidExamStateError
    )
  })

  test('rejects duplicate questions and unbounded timers', ({ assert }) => {
    assert.throws(
      () => normalizeSavedExamState({ ...validState, questionIds: [11, 11] }, 7, 'default'),
      InvalidExamStateError
    )
    assert.throws(
      () => normalizeSavedExamState({ ...validState, time: 8 * 60 * 60 + 1 }, 7, 'default'),
      InvalidExamStateError
    )
  })

  test('requires bounded custom-exam scoring configuration', ({ assert }) => {
    assert.throws(
      () => normalizeSavedExamState({ ...validState, mode: 'custom' }, 7, 'custom'),
      InvalidExamStateError
    )
    assert.doesNotThrow(() =>
      normalizeSavedExamState(
        {
          ...validState,
          mode: 'custom',
          n_of_questions: 5,
          penalizing_factor: 0.5,
        },
        7,
        'custom'
      )
    )
  })
})
