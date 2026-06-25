import type { HttpContext } from '@adonisjs/core/http'
import db from '@adonisjs/lucid/services/db'
import { createHash } from 'node:crypto'
import Subject from '#models/subject'
import Answer from '#models/answer'
import Score from '#models/score'
import StatsService, { EXAM_MODES } from '#services/stats_service'
import { scoreboardVisibilityValidator } from '#validators/subject'
import type { AuthenticatedHttpContext } from '../../contracts/auth.js'

const SCOREBOARD_LIMIT = 30
const MIN_ANSWERS = 3
const SCOREBOARD_MODES = new Set<string>(['all', ...EXAM_MODES])

export default class SubjectsController {
  private parseSubjectId(rawId: unknown): number | null {
    const subjectId = Number(rawId)
    if (!Number.isInteger(subjectId) || subjectId <= 0) {
      return null
    }
    return subjectId
  }

  private serializeSubject(subject: Subject) {
    return {
      id: subject.id,
      name: subject.name,
      slug: subject.slug,
      year: subject.year,
    }
  }

  /**
   * List all subjects.
   * GET /subjects?with_questions=true
   *
   * When `with_questions=true` is passed, only returns subjects
   * that have at least one question.
   */
  async index({ request, response }: HttpContext) {
    const withQuestions = request.input('with_questions')
    const subjects =
      withQuestions === 'true'
        ? await Subject.query().whereHas('questions', (q) => q)
        : await Subject.all()

    return response.ok(subjects.map((subject) => this.serializeSubject(subject)))
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

    return response.ok(this.serializeSubject(subject))
  }

  /**
   * Get detailed per-user stats for a subject.
   * GET /subjects/:id/stats
   *
   * Requires authentication.
   */
  async stats({ authUser, params, response }: AuthenticatedHttpContext) {
    const userId = authUser.id
    const subjectId = this.parseSubjectId(params.id)

    if (subjectId === null) {
      return response.unprocessableEntity({ message: 'Invalid subject id' })
    }

    try {
      const statsService = new StatsService()
      const stats = await statsService.getStats(subjectId, userId)

      return response.ok(stats)
    } catch (error: unknown) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'E_ROW_NOT_FOUND'
      ) {
        return response.notFound({ message: 'Invalid subject' })
      }

      throw error
    }
  }

  /**
   * Get the scoreboard for a subject, optionally filtered by exam mode.
   * GET /subjects/:id/scoreboard/:mode
   *
   * The `mode` param can be 'all' or any specific exam mode (default, hard, wrong, etc.).
   */
  async scoreboard({ params, response }: HttpContext) {
    const subjectId = this.parseSubjectId(params.id)
    const mode = String(params.mode ?? '').toLowerCase()

    if (subjectId === null) {
      return response.unprocessableEntity({ message: 'Invalid subject id' })
    }

    if (!SCOREBOARD_MODES.has(mode)) {
      return response.unprocessableEntity({
        message: `Invalid mode. Allowed values: all, ${EXAM_MODES.join(', ')}`,
      })
    }

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
    const scoresRow = await db
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
      .havingRaw('count(answers.score) >= ?', [MIN_ANSWERS])
      .orderByRaw('s desc, c desc')
      .limit(SCOREBOARD_LIMIT)

    if (mode !== 'all') {
      scoresRow = scoresRow.where('answers.mode', mode)
    }

    const scoresRowResult = await scoresRow
      answers_user_id: score.answers_user_id,
      users_name: score.users_name,
      users_email: score.users_email,
      s: score.s,
      c: score.c,
    }))

    const totalResult = await Answer.query()
      .where('subject_id', subjectId)
      .count('* as total')
      .first()
    const total = Number(totalResult?.$extras.total ?? 0)

    const scoreEntries = scores.map((score) => ({
      user_id: score.answers_user_id,
      user_name: score.users_name,
      avatar: createHash('md5').update(score.users_email.toLowerCase().trim()).digest('hex'),
      score: Number(Number(score.s).toFixed(2)),
      exams: Number(score.c),
    }))

    return response.ok({
      subject_id: subjectId,
      name: subject.name,
      scores: scoreEntries,
      limit: SCOREBOARD_LIMIT,
      min_answers: MIN_ANSWERS,
      total,
    })
  }

  /**
   * Toggle scoreboard visibility for the authenticated user.
   * POST /subjects/:id/scoreboard
   *
   * Requires authentication.
   */
  async scoreboardVisibility({ authUser, params, request, response }: AuthenticatedHttpContext) {
    const userId = authUser.id
    const data = await request.validateUsing(scoreboardVisibilityValidator)

    const subjectId = this.parseSubjectId(params.id)
    if (subjectId === null) {
      return response.unprocessableEntity({ message: 'Invalid subject id' })
    }

    const subject = await Subject.find(subjectId)
    if (!subject) {
      return response.notFound({ message: 'Subject not found' })
    }

    // Use firstOrCreate to handle the NOT NULL score column —
    // if no row exists yet, create one with score defaulting to 0.
    // Then update showScoreboard without overwriting the existing score.
    const scoreRecord = await Score.firstOrCreate(
      { userId, subjectId },
      { score: 0, showScoreboard: data.visibility }
    )
    scoreRecord.showScoreboard = data.visibility
    await scoreRecord.save()

    return response.ok({ message: 'Scoreboard visibility updated.' })
  }
}
