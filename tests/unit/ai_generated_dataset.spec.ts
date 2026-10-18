import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from '@japa/runner'
import {
  getAiGeneratedQuestionProblems,
  InvalidAiGeneratedDatasetError,
  listAiGeneratedSubjects,
  loadAiGeneratedSubjectQuestions,
} from '#services/questions/ai_generated_dataset'

const datasetRoot = fileURLToPath(new URL('../../database/data/ai_generated', import.meta.url))

const validRecord = {
  question: 'O que faz a instrução add?',
  answers: ['Soma', 'Subtrai'],
  correct_index: 0,
  source: 'AI_GENERATED',
}

test.group('AI-generated question record validation', () => {
  test('accepts a valid record, with or without review metadata', ({ assert }) => {
    assert.deepEqual(getAiGeneratedQuestionProblems(validRecord), [])
    assert.deepEqual(
      getAiGeneratedQuestionProblems({ ...validRecord, in_plan: true, ref: 'TP3 p.10' }),
      []
    )
  })

  test('accepts full statements and options beyond 255 characters', ({ assert }) => {
    const longText = 'x'.repeat(1000)
    assert.deepEqual(
      getAiGeneratedQuestionProblems({
        ...validRecord,
        question: longText,
        answers: ['ok', longText],
      }),
      []
    )
  })

  test('rejects a correct_index outside the answers', ({ assert }) => {
    for (const invalidIndex of [-1, 2, 0.5, '0', null]) {
      assert.isNotEmpty(
        getAiGeneratedQuestionProblems({ ...validRecord, correct_index: invalidIndex })
      )
    }
  })

  test('rejects empty, duplicate and too few answers', ({ assert }) => {
    for (const answers of [['only one'], ['a', 'a'], ['a', ' '], 'a,b']) {
      assert.isNotEmpty(getAiGeneratedQuestionProblems({ ...validRecord, answers }))
    }
  })

  test('rejects a source other than AI_GENERATED', ({ assert }) => {
    for (const source of ['REAL_EXAM', 'MANUAL', undefined]) {
      assert.isNotEmpty(getAiGeneratedQuestionProblems({ ...validRecord, source }))
    }
  })

  test('rejects values that are not records', ({ assert }) => {
    for (const record of [null, 'text', 3, []]) {
      assert.isNotEmpty(getAiGeneratedQuestionProblems(record))
    }
  })
})

test.group('AI-generated question loader', (group) => {
  let directory: string

  group.each.setup(async () => {
    directory = await mkdtemp(join(tmpdir(), 'ai-generated-'))
    return () => rm(directory, { recursive: true, force: true })
  })

  test('loads files in name order', async ({ assert }) => {
    await writeFile(
      join(directory, '02.json'),
      JSON.stringify([{ ...validRecord, question: 'second' }])
    )
    await writeFile(
      join(directory, '01.json'),
      JSON.stringify([{ ...validRecord, question: 'first' }])
    )

    const questions = await loadAiGeneratedSubjectQuestions(directory)

    assert.deepEqual(
      questions.map((entry) => entry.question),
      ['first', 'second']
    )
  })

  test('reports every problem instead of skipping records silently', async ({ assert }) => {
    await writeFile(
      join(directory, '01.json'),
      JSON.stringify([
        validRecord,
        { ...validRecord, question: 'bad index', correct_index: 9 },
        { ...validRecord, question: ' ' },
      ])
    )

    const error = await loadAiGeneratedSubjectQuestions(directory).catch((e) => e)

    assert.instanceOf(error, InvalidAiGeneratedDatasetError)
    assert.lengthOf(error.problems, 2)
    assert.match(error.problems[0], /^01\.json#1: /)
    assert.match(error.problems[1], /^01\.json#2: /)
  })

  test('rejects duplicate question text across files', async ({ assert }) => {
    await writeFile(join(directory, '01.json'), JSON.stringify([validRecord]))
    await writeFile(join(directory, '02.json'), JSON.stringify([validRecord]))

    const error = await loadAiGeneratedSubjectQuestions(directory).catch((e) => e)

    assert.instanceOf(error, InvalidAiGeneratedDatasetError)
    assert.match(
      error.problems[0],
      /^02\.json#0: duplicate question text, first seen at 01\.json#0/
    )
  })

  test('rejects malformed JSON and non-array files', async ({ assert }) => {
    await writeFile(join(directory, '01.json'), '{ not json')
    await writeFile(join(directory, '02.json'), JSON.stringify({ question: 'not an array' }))

    const error = await loadAiGeneratedSubjectQuestions(directory).catch((e) => e)

    assert.instanceOf(error, InvalidAiGeneratedDatasetError)
    assert.lengthOf(error.problems, 2)
  })

  test('lists only subject directories', async ({ assert }) => {
    await mkdir(join(directory, 'zzz'))
    await mkdir(join(directory, 'aaa'))
    await writeFile(join(directory, 'README.json'), '[]')

    assert.deepEqual(await listAiGeneratedSubjects(directory), ['aaa', 'zzz'])
  })
})

test.group('Committed AI-generated question bank', () => {
  test('every committed candidate subject loads for review', async ({ assert }) => {
    const subjects = await listAiGeneratedSubjects(datasetRoot)
    assert.include(subjects, 'arqcp')

    for (const subject of subjects) {
      const questions = await loadAiGeneratedSubjectQuestions(join(datasetRoot, subject))
      assert.isAbove(questions.length, 0, `${subject} has no questions`)
    }
  })

  test('the ARQCP bank keeps its 2767 questions and none is silently dropped', async ({
    assert,
  }) => {
    const questions = await loadAiGeneratedSubjectQuestions(join(datasetRoot, 'arqcp'))

    assert.lengthOf(questions, 2767)
    assert.equal(questions.filter((entry) => entry.answers.length === 2).length, 690)
    assert.equal(questions.filter((entry) => entry.answers.length === 4).length, 2077)
  })
})
