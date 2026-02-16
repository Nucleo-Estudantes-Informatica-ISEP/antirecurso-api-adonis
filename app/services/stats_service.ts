import db from '@adonisjs/lucid/services/db'
import Answer from '#models/answer'
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

    // Batch independent reads to reduce DB round trips:
    // 1) user+subject answer_question aggregates
    // 2) full user scores for this subject
    // 3) scoreboard rank
    const [questionStatsResult, userScores, rankResult] = await Promise.all([
      db.rawQuery(
        `
        WITH user_subject_answer_questions AS (
          SELECT aq.id, aq.question_id, aq.is_wrong
          FROM answer_questions aq
          INNER JOIN answers a ON aq.answer_id = a.id
          INNER JOIN questions q ON aq.question_id = q.id
          WHERE a.user_id = ?
            AND q.subject_id = ?
        ),
        latest_answer_per_question AS (
          SELECT
            question_id,
            is_wrong,
            row_number() OVER (PARTITION BY question_id ORDER BY id DESC) AS rn
          FROM user_subject_answer_questions
        )
        SELECT
          (SELECT count(*) FROM questions WHERE subject_id = ?) AS total_questions,
          (SELECT count(*) FROM user_subject_answer_questions) AS n_of_answers,
          (SELECT count(DISTINCT question_id) FROM user_subject_answer_questions) AS n_of_distinct_questions_answered,
          (
            SELECT count(*)
            FROM latest_answer_per_question
            WHERE rn = 1
              AND is_wrong = true
          ) AS n_of_wrong_distinct_questions_answered
        `,
        [userId, subjectId, subjectId]
      ),
      Answer.query().where('user_id', userId).where('subject_id', subjectId),
      db.rawQuery(
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
      ),
    ])

    const questionStats = questionStatsResult.rows?.[0]
    const totalQuestions = Number(questionStats?.total_questions ?? 0)
    const nOfAnswers = Number(questionStats?.n_of_answers ?? 0)
    const nOfDistinctQuestionsAnswered = Number(
      questionStats?.n_of_distinct_questions_answered ?? 0
    )
    const nOfWrongDistinctQuestionsAnswered = Number(
      questionStats?.n_of_wrong_distinct_questions_answered ?? 0
    )
    const nOfCorrectAnswers = nOfDistinctQuestionsAnswered - nOfWrongDistinctQuestionsAnswered

    const examWeight = EXAM_WEIGHTS[subjectSlug] ?? EXAM_WEIGHTS['default']
    const minGrade = MIN_GRADES[subjectSlug] ?? MIN_GRADES['default']

    // Derive exam-level metrics from one user scores query
    const examsTaken = userScores.length
    const nOfExamsPassed = userScores.filter(
      (answer) => answer.score >= EXAM_MAX_GRADE / 2 - 5
    ).length
    const averageGrade =
      examsTaken > 0 ? userScores.reduce((sum, answer) => sum + answer.score, 0) / examsTaken : 0

    const modeScores: Record<string, number> = Object.fromEntries(
      EXAM_MODES.map((mode) => [mode, 0])
    )
    for (const answer of userScores) {
      if (answer.mode in modeScores) {
        modeScores[answer.mode] += 1
      }
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

    // Times and mean time (null time values count as 0 to match previous behavior)
    const times = userScores.map((answer) => ({ time: answer.time }))
    const meanTime =
      examsTaken > 0
        ? userScores.reduce((sum, answer) => sum + (answer.time ?? 0), 0) / examsTaken
        : null

    const placeInScoreboard = rankResult.rows?.[0]?.rank ? Number(rankResult.rows[0].rank) : null

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
