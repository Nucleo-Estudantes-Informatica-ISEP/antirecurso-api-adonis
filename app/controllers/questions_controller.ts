import type { HttpContext } from '@adonisjs/core/http'
import db from '@adonisjs/lucid/services/db'
import Question from '#models/question'
import Option from '#models/option'
import { updateQuestionValidator } from '#validators/question'
import { hasAuthNeiRole } from '#services/auth/auth_nei_roles'

class QuestionOptionOwnershipError extends Error {
  constructor() {
    super('One or more option IDs do not belong to this question')
    this.name = 'QuestionOptionOwnershipError'
  }
}

export default class QuestionsController {
  /**
   * Update a question's text, correct option, and option names.
   * PUT /questions/:id
   */
  async update({ authClaims, params, request, response }: HttpContext) {
    if (!hasAuthNeiRole(authClaims, 'admin')) {
      return response.forbidden({ message: 'You are not an admin' })
    }

    const data = await request.validateUsing(updateQuestionValidator)

    const question = await Question.query().where('id', params.id).preload('options').firstOrFail()

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

        // Knex .update() returns different types depending on the DB driver:
        //   - PostgreSQL (pg): returns number (affected row count directly)
        //   - MySQL (mysql2): returns number[] with affected count at index 0
        //   - SQLite (better-sqlite3): returns number[] with affected count at index 0
        // We normalize to a plain number, defaulting to 0 if the array is empty.
        const normalizeAffectedRows = (result: number | number[] | unknown[]): number => {
          if (Array.isArray(result)) {
            return result.length > 0 ? Number(result[0]) : 0
          }
          return Number(result)
        }

        const affectedRows = await Promise.all(
          data.options.map(async (o) => {
            const result = await Option.query({ client: trx })
              .where('id', o.id)
              .where('question_id', question.id)
              .update({ name: o.name })
            return normalizeAffectedRows(result)
          })
        )

        // Each result is the number of affected rows; must be exactly 1
        const allMatched = affectedRows.every((count) => count === 1)
        if (!allMatched) {
          throw new QuestionOptionOwnershipError()
        }
      })

      return response.noContent()
    } catch (error: unknown) {
      if (error instanceof QuestionOptionOwnershipError) {
        return response.unprocessableEntity({ message: error.message })
      }
      if (error instanceof Error && error.message.startsWith('correct_option must be')) {
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
