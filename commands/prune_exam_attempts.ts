import { BaseCommand } from '@adonisjs/core/ace'
import db from '@adonisjs/lucid/services/db'
import User from '#models/user'
import ExamAttempt from '#models/exam_attempt'
import {
  pruneUnfinishedAttempts,
  unfinishedAttemptCutoff,
} from '#services/exams/exam_attempt_lifecycle'

export default class PruneExamAttempts extends BaseCommand {
  static commandName = 'exams:prune-attempts'
  static description = 'Delete unfinished attempts inactive for 30 days and their bound drafts'
  static options = { startApp: true }

  async run() {
    let lastOwner = 0
    for (;;) {
      const owners = await ExamAttempt.query()
        .whereNull('result')
        .where('updated_at', '<', unfinishedAttemptCutoff())
        .where('user_id', '>', lastOwner)
        .distinct('user_id')
        .orderBy('user_id')
        .limit(100)
      if (!owners.length) break
      for (const { userId } of owners) {
        await db.transaction(async (trx) => {
          const user = await User.query({ client: trx }).where('id', userId).forUpdate().first()
          if (user) await pruneUnfinishedAttempts(trx, userId)
        })
        lastOwner = userId
      }
    }
    this.logger.success('Stale unfinished attempts pruned; completed history retained')
  }
}
