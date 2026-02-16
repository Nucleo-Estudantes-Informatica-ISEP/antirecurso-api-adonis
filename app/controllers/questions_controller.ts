import type { HttpContext } from '@adonisjs/core/http'
import Question from '#models/question'
import Option from '#models/option'
import { updateQuestionValidator } from '#validators/question'

export default class QuestionsController {
  /**
   * Update a question's text, correct option, and option names.
   * PUT /questions/:id
   */
  async update({ params, request, response }: HttpContext) {
    // TODO: add auth middleware + admin check when auth service is integrated
    const data = await request.validateUsing(updateQuestionValidator)

    const question = await Question.findOrFail(params.id)

    question.question = data.question
    question.correctOption = data.correct_option
    await question.save()

    // Update each option
    for (const o of data.options) {
      const option = await Option.findOrFail(o.id)
      option.name = o.name
      await option.save()
    }

    return response.noContent()
  }

  /**
   * Show a single question with options and question type.
   * GET /questions/:id
   */
  async show({ params, response }: HttpContext) {
    const question = await Question.query()
      .where('id', params.id)
      .preload('options')
      .preload('questionType')
      .firstOrFail()

    return response.ok({
      id: question.id,
      question: question.question,
      exam: question.exam,
      image: question.image,
      question_type: question.questionType.name,
      options: question.options.map((opt) => ({
        name: opt.name,
        order: opt.order,
      })),
    })
  }
}
