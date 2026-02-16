import db from '@adonisjs/lucid/services/db'
import Answer from '#models/answer'
import AnswerQuestion from '#models/answer_question'
import Question from '#models/question'
import Subject from '#models/subject'

/**
 * Subject-specific configuration constants.
 * These mirror the Laravel SubjectController constants.
 */
const EXAM_WEIGHTS: Record<string, number> = {
  rcomp: 0.3,
  scomp: 0.6,
  algav: 0.5,
  sgrai: 0.3,
  prcmp: 0.55,
  arqcp: 0.4,
  asist: 0.4,
  default: 0.5,
}

const MIN_GRADES: Record<string, number> = {
  rcomp: 7,
  scomp: 7.5,
  algav: 7.5,
  sgrai: 8,
  prcmp: 8,
  arqcp: 7.5,
  asist: 9,
  default: 9.5,
}

export const EXAM_MODES = ['default', 'hard', 'wrong', 'custom', 'realistic', 'new'] as const
const EXAM_MAX_GRADE = 100

export default class StatsService {
  /**
   * Compute detailed per-user statistics for a subject.
   * Ported from Laravel SubjectController::stats().
   */
  async getStats(subjectId: number, userId: number) {
    const subject = await Subject.findOrFail(subjectId)
    const subjectSlug = subject.slug

    // Number of distinct questions the user has answered for this subject
    const distinctQuestionsResult = await AnswerQuestion.query()
      .whereHas('answer', (q) => q.where('user_id', userId))
      .whereHas('question', (q) => q.where('subject_id', subjectId))
      .countDistinct('question_id as total')
      .first()
    const nOfDistinctQuestionsAnswered = Number(distinctQuestionsResult?.$extras.total ?? 0)

    // Total distinct questions available for subject
    const totalOfQuestions = await Question.query()
      .where('subject_id', subjectId)
      .count('* as total')
      .first()
    const totalQuestions = Number(totalOfQuestions?.$extras.total ?? 0)

    // Number of questions where the user's last answer was wrong.
    // This mirrors the complex sub-query logic from Laravel:
    // 1. Find answer_questions marked as wrong for this user+subject
    // 2. Exclude questions where the user also has a correct answer that was the latest
    const nOfWrongResult = await AnswerQuestion.query()
      .whereHas('answer', (q) => q.where('user_id', userId))
      .whereHas('question', (q) => q.where('subject_id', subjectId))
      .where('is_wrong', true)
      .whereNotIn('question_id', (subQuery) => {
        subQuery
          .from('answer_questions')
          .select('answer_questions.question_id')
          .innerJoin('answers', 'answer_questions.answer_id', 'answers.id')
          .where('answers.user_id', userId)
          .where('answer_questions.is_wrong', false)
          .whereIn('answer_questions.question_id', (innerQuery) => {
            innerQuery
              .from('answer_questions')
              .select('answer_questions.question_id')
              .innerJoin('answers', 'answer_questions.answer_id', 'answers.id')
              .where('answers.user_id', userId)
              .groupBy('answer_questions.question_id')
              .havingRaw('MAX(answer_questions.id) = answer_questions.id')
          })
      })
      .countDistinct('question_id as total')
      .first()
    const nOfWrongDistinctQuestionsAnswered = Number(nOfWrongResult?.$extras.total ?? 0)

    const nOfCorrectAnswers = nOfDistinctQuestionsAnswered - nOfWrongDistinctQuestionsAnswered

    // Total number of answer_questions (not distinct) for user + subject
    const totalAnswersResult = await AnswerQuestion.query()
      .whereHas('answer', (q) => q.where('user_id', userId))
      .whereHas('question', (q) => q.where('subject_id', subjectId))
      .count('* as total')
      .first()
    const nOfAnswers = Number(totalAnswersResult?.$extras.total ?? 0)

    // Number of exams taken
    const nOfExamsTaken = await Answer.query()
      .where('user_id', userId)
      .where('subject_id', subjectId)
      .count('* as total')
      .first()
    const examsTaken = Number(nOfExamsTaken?.$extras.total ?? 0)

    const examWeight = EXAM_WEIGHTS[subjectSlug] ?? EXAM_WEIGHTS['default']
    const minGrade = MIN_GRADES[subjectSlug] ?? MIN_GRADES['default']

    // Number of exams passed (score >= EXAM_MAX_GRADE / 2 - 5 = 45)
    const nOfExamsPassedResult = await Answer.query()
      .where('user_id', userId)
      .where('subject_id', subjectId)
      .where('score', '>=', EXAM_MAX_GRADE / 2 - 5)
      .count('* as total')
      .first()
    const nOfExamsPassed = Number(nOfExamsPassedResult?.$extras.total ?? 0)

    // User scores and average
    const userScores = await Answer.query()
      .where('user_id', userId)
      .where('subject_id', subjectId)
    const averageGrade =
      userScores.length > 0
        ? userScores.reduce((sum, a) => sum + a.score, 0) / userScores.length
        : 0

    // Per-mode exam counts — single query instead of one per mode
    const modeCountRows = await Answer.query()
      .where('user_id', userId)
      .where('subject_id', subjectId)
      .groupBy('mode')
      .select('mode')
      .count('* as total')

    const modeScores: Record<string, number> = {}
    for (const mode of EXAM_MODES) {
      const row = modeCountRows.find((r) => r.mode === mode)
      modeScores[mode] = Number(row?.$extras.total ?? 0)
    }

    // Suggested mode heuristic
    let suggestedMode = 'default'
    if (nOfDistinctQuestionsAnswered >= totalQuestions * 0.4 && nOfDistinctQuestionsAnswered > 0) {
      const wrongRatio = nOfWrongDistinctQuestionsAnswered / nOfDistinctQuestionsAnswered
      if (wrongRatio >= 0.3) {
        suggestedMode = 'wrong'
      } else if (wrongRatio >= 0.2) {
        suggestedMode = 'hard'
      } else if (nOfDistinctQuestionsAnswered / totalQuestions <= 0.7) {
        suggestedMode = 'new'
      } else {
        suggestedMode = 'realistic'
      }
    }

    // Times and mean time
    const times = await Answer.query()
      .where('user_id', userId)
      .where('subject_id', subjectId)
      .select('time')
    const meanTime =
      times.length > 0 ? times.reduce((sum, a) => sum + (a.time ?? 0), 0) / times.length : null

    // Place in scoreboard — computed in SQL via dense_rank() to avoid loading all users
    const rankResult = await db.rawQuery(
      `
      WITH ranked AS (
        SELECT
          answers.user_id,
          avg(answers.score) AS s,
          count(answers.score) AS c,
          dense_rank() OVER (ORDER BY avg(answers.score) DESC, count(answers.score) DESC) AS rank
        FROM answers
        WHERE answers.subject_id = ?
          AND answers.user_id IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM scores
            WHERE scores.user_id = answers.user_id
              AND scores.subject_id = ?
              AND scores.show_scoreboard = true
          )
        GROUP BY answers.user_id
        HAVING count(answers.score) >= 3
      )
      SELECT rank FROM ranked WHERE user_id = ?
      `,
      [subjectId, subjectId, userId]
    )

    const placeInScoreboard = rankResult.rows?.[0]?.rank
      ? Number(rankResult.rows[0].rank)
      : null

    return {
      n_of_answers: nOfDistinctQuestionsAnswered,
      total_of_questions: totalQuestions,
      n_of_wrong_answers: nOfWrongDistinctQuestionsAnswered,
      n_of_correct: nOfCorrectAnswers,
      min_grade: minGrade,
      n_of_answered: nOfAnswers,
      average_grade: Number(averageGrade.toFixed(2)),
      n_of_exams_taken: examsTaken,
      n_of_exams_passed: nOfExamsPassed,
      user_scores: userScores,
      exam_weight: examWeight,
      percentage_of_exams_passed:
        examsTaken > 0 ? Number(((nOfExamsPassed / examsTaken) * 100).toFixed(2)) : 0,
      percentage_of_correct_answers:
        nOfDistinctQuestionsAnswered > 0
          ? Number(((nOfCorrectAnswers / nOfDistinctQuestionsAnswered) * 100).toFixed(2))
          : 0,
      percentage_of_questions_seen:
        totalQuestions > 0
          ? Number(((nOfDistinctQuestionsAnswered / totalQuestions) * 100).toFixed(2))
          : 0,
      mode_scores: modeScores,
      suggested_mode: suggestedMode,
      times: times,
      mean_time: meanTime,
      place_in_scoreboard: placeInScoreboard,
    }
  }
}
