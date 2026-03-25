import { readFile } from 'node:fs/promises'

import { BaseSeeder } from '@adonisjs/lucid/seeders'

import Option from '#models/option'
import Question from '#models/question'
import QuestionType from '#models/question_type'
import Subject from '#models/subject'

const DEFAULT_YEAR = 2024
const MAX_DB_STRING_LENGTH = 255

type LegacyQuestion = {
  question: string
  answers: string[]
  correct_index: number
}

type LegacyQuestionDataset = Record<string, LegacyQuestion[]>

export default class extends BaseSeeder {
  private async loadDataset(): Promise<LegacyQuestionDataset> {
    const fileUrl = new URL('./data/questions.json', import.meta.url)
    const fileContents = await readFile(fileUrl, 'utf8')

    return JSON.parse(fileContents) as LegacyQuestionDataset
  }

  private isQuestionValid(question: LegacyQuestion) {
    if (!Number.isInteger(question.correct_index) || question.correct_index < 0) {
      return false
    }

    if (question.correct_index >= question.answers.length) {
      return false
    }

    if (question.question.length > MAX_DB_STRING_LENGTH) {
      return false
    }

    return question.answers.every((answer) => answer.length <= MAX_DB_STRING_LENGTH)
  }

  async run() {
    const dataset = await this.loadDataset()

    for (const [subjectName, questions] of Object.entries(dataset)) {
      const slug = subjectName.toLowerCase()

      const subject = await Subject.updateOrCreate(
        { slug },
        {
          name: subjectName,
          slug,
          year: DEFAULT_YEAR,
        },
        { client: this.client }
      )

      const questionType = await QuestionType.updateOrCreate(
        {
          subjectId: subject.id,
          name: subjectName,
        },
        {
          subjectId: subject.id,
          name: subjectName,
        },
        { client: this.client }
      )

      for (const legacyQuestion of questions) {
        if (!this.isQuestionValid(legacyQuestion)) {
          continue
        }

        const question = await Question.updateOrCreate(
          {
            subjectId: subject.id,
            exam: subjectName,
            question: legacyQuestion.question,
          },
          {
            question: legacyQuestion.question,
            image: '',
            exam: subjectName,
            correctOption: String(legacyQuestion.correct_index + 1),
            subjectId: subject.id,
            questionTypeId: questionType.id,
          },
          { client: this.client }
        )

        for (const [index, answer] of legacyQuestion.answers.entries()) {
          const order = String(index + 1)

          await Option.updateOrCreate(
            {
              questionId: question.id,
              order,
            },
            {
              questionId: question.id,
              order,
              name: answer,
            },
            { client: this.client }
          )
        }
      }
    }
  }
}
