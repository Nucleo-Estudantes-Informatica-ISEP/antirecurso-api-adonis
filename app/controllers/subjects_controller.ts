import type { HttpContext } from '@adonisjs/core/http'
import db from '@adonisjs/lucid/services/db'
import { createHash } from 'node:crypto'
import Subject from '#models/subject'
import Question from '#models/question'
import Answer from '#models/answer'
import Score from '#models/score'
import User from '#models/user'
import StatsService from '#services/stats_service'
import { scoreboardVisibilityValidator, tempAuthValidator } from '#validators/subject'

const SCOREBOARD_LIMIT = 30
const MIN_ANSWERS = 3

export default class SubjectsController {
  /**
   * List all subjects.
   * GET /subjects?with_questions=true
   *
   * When `with_questions=true` is passed, only returns subjects
   * that have at least one question.
   */
  async index({ request, response }: HttpContext) {
    const withQuestions = request.input('with_questions')

    if (withQuestions === 'true') {
      const subjects = await Subject.query().whereHas('questions')

      return response.ok({
        data: subjects.map((s) => ({
          id: s.id,
          name: s.name,
          slug: s.slug,
          year: s.year,
        })),
      })
    }

    const subjects = await Subject.all()
    return response.ok({
      data: subjects.map((s) => ({
        id: s.id,
        name: s.name,
        slug: s.slug,
        year: s.year,
      })),
    })
  }

  /**
   * Show a single subject.
   * GET /subjects/:id
   */
  async show({ params, response }: HttpContext) {
    const subject = await Subject.find(params.id)

    if (!subject) {
      return response.notFound({ message: 'Invalid subject' })
    }

    return response.ok({
      id: subject.id,
      name: subject.name,
      slug: subject.slug,
      year: subject.year,
    })
  }

  /**
   * Get detailed per-user stats for a subject.
   * GET /subjects/:id/stats
   *
   * Requires authentication.
   */
  async stats({ params, request, response }: HttpContext) {
    // TODO: Replace with auth middleware when auth service is integrated
    const { user_id: userId } = await request.validateUsing(tempAuthValidator)

    const statsService = new StatsService()
    const stats = await statsService.getStats(Number(params.id), userId)

    return response.ok(stats)
  }

  /**
   * Get the scoreboard for a subject, optionally filtered by exam mode.
   * GET /subjects/:id/scoreboard/:mode
   *
   * The `mode` param can be 'all' or any specific exam mode (default, hard, wrong, etc.).
   */
  async scoreboard({ params, response }: HttpContext) {
    const subjectId = Number(params.id)
    const mode = params.mode

    const subject = await Subject.find(subjectId)
    if (!subject) {
      return response.notFound({ message: 'Invalid subject' })
    }

    // Build the scoreboard query — joins users to avoid N+1 queries
    let query = db
      .from('answers')
      .innerJoin('users', 'users.id', 'answers.user_id')
      .where('answers.subject_id', subjectId)
      .whereNotNull('answers.user_id')
      .whereExists((builder) => {
        builder
          .from('scores')
          .whereRaw('scores.user_id = answers.user_id')
          .where('scores.subject_id', subjectId)
          .where('scores.show_scoreboard', true)
      })
      .groupBy('answers.user_id', 'users.id', 'users.name', 'users.email')
      .select('answers.user_id')
      .select('users.name as user_name')
      .select('users.email as user_email')
      .select(db.raw('avg(answers.score) as s'))
      .select(db.raw('count(answers.score) as c'))
      .havingRaw(`count(answers.score) >= ${MIN_ANSWERS}`)
      .orderByRaw('s desc, c desc')
      .limit(SCOREBOARD_LIMIT)

    if (mode !== 'all') {
      query = query.where('answers.mode', mode)
    }

    const scores = await query

    // Get total answers for the subject
    const totalResult = await Answer.query()
      .where('subject_id', subjectId)
      .count('* as total')
      .first()
    const total = Number(totalResult?.$extras.total ?? 0)

    // Build the response — no extra queries needed, user data is already joined
    const scoreEntries = scores.map(
      (score: { user_id: number; user_name: string; user_email: string; s: number; c: number }) => ({
        user_id: score.user_id,
        user_name: score.user_name,
        avatar: createHash('md5')
          .update(score.user_email.toLowerCase().trim())
          .digest('hex'),
        score: Number(Number(score.s).toFixed(2)),
        exams: Number(score.c),
      })
    )

    return response.ok({
      subject_id: subjectId,
      name: subject.name,
      scores: scoreEntries,
      limit: SCOREBOARD_LIMIT,
      min_answers: MIN_ANSWERS,
      total: total,
    })
  }

  /**
   * Toggle scoreboard visibility for the authenticated user.
   * POST /subjects/:id/scoreboard
   *
   * Requires authentication.
   */
  async scoreboardVisibility({ params, request, response }: HttpContext) {
    // TODO: Replace with auth middleware when auth service is integrated
    const { user_id: userId } = await request.validateUsing(tempAuthValidator)
    const data = await request.validateUsing(scoreboardVisibilityValidator)

    await Score.updateOrCreate(
      { userId, subjectId: Number(params.id) },
      { showScoreboard: data.visibility }
    )

    return response.ok({ message: 'Scoreboard visibility updated.' })
  }
}
