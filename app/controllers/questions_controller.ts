import type { HttpContext } from '@adonisjs/core/http'
import db from '@adonisjs/lucid/services/db'
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

        const question = await Question.query()
            .where('id', params.id)
            .preload('options')
            .firstOrFail()

        const validOrders = question.options.map((opt) => opt.order)
        if (!validOrders.includes(data.correct_option)) {
            return response.unprocessableEntity({
                message: `correct_option must be one of: ${validOrders.join(', ')}`,
            })
        }

        try {
            await db.transaction(async (trx) => {
                question.useTransaction(trx)
                question.question = data.question
                question.correctOption = data.correct_option
                await question.save()

                const results = await Promise.all(
                    data.options.map((o) =>
                        Option.query({ client: trx })
                            .where('id', o.id)
                            .where('question_id', question.id)
                            .update({ name: o.name })
                    )
                )

                // Each result is the number of affected rows; must be exactly 1
                const allMatched = results.every((count) => count[0] === 1)
                if (!allMatched) {
                    throw new Error('One or more option IDs do not belong to this question')
                }
            })

            return response.noContent()
        } catch (error: any) {
            if (error.message === 'One or more option IDs do not belong to this question') {
                return response.unprocessableEntity({ message: error.message })
            }
            throw error
        }
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
                id: opt.id,
                name: opt.name,
                order: opt.order,
            })),
        })
    }
}
