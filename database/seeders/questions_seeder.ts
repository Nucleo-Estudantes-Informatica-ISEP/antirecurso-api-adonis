import { BaseSeeder } from '@adonisjs/lucid/seeders'
import env from '#start/env'
import Subject from '#models/subject'
import QuestionType from '#models/question_type'
import Question from '#models/question'
import Option from '#models/option'

/** Synthetic local UI fixtures only. Never reads or approves a candidate bank. */
export default class extends BaseSeeder {
  async run() {
    if (!['development', 'test'].includes(env.get('NODE_ENV'))) {
      throw new Error(
        'Development fixtures are disabled here. Use questions:import for publication.'
      )
    }
    await this.client.transaction(async (trx) => {
      const subject = await Subject.firstOrCreate(
        { slug: 'dev-fixtures' },
        { name: 'Development fixtures (not academic content)', year: 1 },
        { client: trx }
      )
      const type = await QuestionType.firstOrCreate(
        { subjectId: subject.id, name: 'Synthetic examples' },
        {},
        { client: trx }
      )
      const question = await Question.firstOrCreate(
        { importKey: 'dev-fixture:arithmetic:v1' },
        {
          subjectId: subject.id,
          questionTypeId: type.id,
          question: '[DEV FIXTURE] What is 1 + 1?',
          image: '',
          exam: 'Development fixture only',
          correctOption: 'B',
          source: 'MANUAL',
          review: null,
          ref: 'Synthetic local data; no academic approval',
        },
        { client: trx }
      )
      for (const option of [
        { order: 'A', name: '1' },
        { order: 'B', name: '2' },
      ]) {
        await Option.firstOrCreate(
          { questionId: question.id, order: option.order },
          { name: option.name },
          { client: trx }
        )
      }
    })
  }
}
