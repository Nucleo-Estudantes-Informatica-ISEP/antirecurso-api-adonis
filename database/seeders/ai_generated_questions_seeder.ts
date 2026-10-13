import { fileURLToPath } from 'node:url'

import { BaseSeeder } from '@adonisjs/lucid/seeders'

import Option from '#models/option'
import Question from '#models/question'
import QuestionType from '#models/question_type'
import Subject from '#models/subject'
import {
  listAiGeneratedSubjects,
  loadAiGeneratedSubjectQuestions,
} from '#services/questions/ai_generated_dataset'

const DEFAULT_YEAR = 2024

export default class extends BaseSeeder {
  async run() {
    const rootDirectory = fileURLToPath(new URL('../data/ai_generated', import.meta.url))
    const slugs = await listAiGeneratedSubjects(rootDirectory)

    const datasets = new Map<string, Awaited<ReturnType<typeof loadAiGeneratedSubjectQuestions>>>()
    for (const slug of slugs) {
      datasets.set(slug, await loadAiGeneratedSubjectQuestions(`${rootDirectory}/${slug}`))
    }

    await this.client.transaction(async (trx) => {
      for (const [slug, questions] of datasets) {
        const subject = await Subject.firstOrCreate(
          { slug },
          { name: slug, slug, year: DEFAULT_YEAR },
          { client: trx }
        )

        const questionType = await QuestionType.firstOrCreate(
          { subjectId: subject.id, name: slug },
          { subjectId: subject.id, name: slug },
          { client: trx }
        )

        const exam = `${slug}-ai-generated`

        for (const entry of questions) {
          const question = await Question.updateOrCreate(
            { subjectId: subject.id, exam, question: entry.question },
            {
              question: entry.question,
              image: '',
              exam,
              correctOption: String(entry.correct_index + 1),
              source: 'AI_GENERATED',
              subjectId: subject.id,
              questionTypeId: questionType.id,
            },
            { client: trx }
          )

          const orders = entry.answers.map((_, index) => String(index + 1))

          for (const [index, answer] of entry.answers.entries()) {
            await Option.updateOrCreate(
              { questionId: question.id, order: orders[index] },
              { questionId: question.id, order: orders[index], name: answer },
              { client: trx }
            )
          }

          await Option.query({ client: trx })
            .where('questionId', question.id)
            .whereNotIn('order', orders)
            .delete()
        }
      }
    })
  }
}
