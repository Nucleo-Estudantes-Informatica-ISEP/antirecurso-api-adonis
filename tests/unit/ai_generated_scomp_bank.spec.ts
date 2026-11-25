import { fileURLToPath } from 'node:url'
import { test } from '@japa/runner'
import { loadAiGeneratedSubjectQuestions } from '#services/questions/ai_generated_dataset'

const scompDirectory = fileURLToPath(
  new URL('../../database/data/ai_generated/scomp', import.meta.url)
)

test.group('AI-generated SCOMP question bank', () => {
  test('loads without problems and keeps its 1545 questions', async ({ assert }) => {
    const questions = await loadAiGeneratedSubjectQuestions(scompDirectory)

    assert.lengthOf(questions, 1545)
    assert.equal(questions.filter((entry) => entry.answers.length === 2).length, 509)
    assert.equal(questions.filter((entry) => entry.answers.length === 4).length, 1036)
  })

  test('only uses true/false and four-option formats', async ({ assert }) => {
    const questions = await loadAiGeneratedSubjectQuestions(scompDirectory)

    for (const entry of questions) {
      assert.include([2, 4], entry.answers.length, entry.question)
      if (entry.answers.length === 2) {
        assert.deepEqual(entry.answers, ['FALSO', 'VERDADEIRO'], entry.question)
      }
    }
  })

  test('every question is marked AI_GENERATED and cites its source material', async ({
    assert,
  }) => {
    const questions = await loadAiGeneratedSubjectQuestions(scompDirectory)

    for (const entry of questions) {
      assert.equal(entry.source, 'AI_GENERATED', entry.question)
      assert.isString(entry.ref, entry.question)
      assert.isNotEmpty(entry.ref, entry.question)
    }
  })

  test('the correct answers are spread across all positions', async ({ assert }) => {
    const questions = await loadAiGeneratedSubjectQuestions(scompDirectory)
    const fourOptions = questions.filter((entry) => entry.answers.length === 4)
    const positions = [0, 1, 2, 3].map(
      (position) => fourOptions.filter((entry) => entry.correct_index === position).length
    )

    for (const count of positions) {
      assert.isAbove(count / fourOptions.length, 0.2)
      assert.isBelow(count / fourOptions.length, 0.3)
    }
  })

  test('the correct answer is not systematically the longest option', async ({ assert }) => {
    const questions = await loadAiGeneratedSubjectQuestions(scompDirectory)
    const fourOptions = questions.filter((entry) => entry.answers.length === 4)
    const lengths = (entry: (typeof fourOptions)[number]) => entry.answers.map((a) => a.length)

    const longestOrTied = fourOptions.filter((entry) => {
      const sizes = lengths(entry)
      return sizes[entry.correct_index] === Math.max(...sizes)
    })
    const firstLongest = fourOptions.filter((entry) => {
      const sizes = lengths(entry)
      return sizes.indexOf(Math.max(...sizes)) === entry.correct_index
    })

    assert.isBelow(longestOrTied.length / fourOptions.length, 0.3)
    assert.isBelow(firstLongest.length / fourOptions.length, 0.25)
  })

  test('true/false questions are roughly balanced between true and false', async ({ assert }) => {
    const questions = await loadAiGeneratedSubjectQuestions(scompDirectory)
    const trueFalse = questions.filter((entry) => entry.answers.length === 2)
    const trueShare =
      trueFalse.filter((entry) => entry.correct_index === 1).length / trueFalse.length

    assert.isAbove(trueShare, 0.4)
    assert.isBelow(trueShare, 0.65)
  })

  test('multiple-choice statements end with a question mark and true/false with a full stop', async ({
    assert,
  }) => {
    const questions = await loadAiGeneratedSubjectQuestions(scompDirectory)

    for (const entry of questions) {
      const text = entry.question.trim()
      if (entry.answers.length === 4) assert.match(text, /\?$/, entry.question)
      else assert.match(text, /\.$/, entry.question)
    }
  })
})
