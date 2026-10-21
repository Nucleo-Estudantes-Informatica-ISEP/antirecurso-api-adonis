import { readFile } from 'node:fs/promises'
import { BaseCommand, args, flags } from '@adonisjs/core/ace'
import { importReviewedQuestions } from '#services/questions/reviewed_import'

export default class ImportQuestions extends BaseCommand {
  static commandName = 'questions:import'
  static description = 'Report or apply a question batch with operator-supplied review notes'
  static options = { startApp: true }

  @args.string({ description: 'Reviewed JSON batch file' })
  declare file: string

  @flags.boolean({ description: 'Commit changes and recoverable audit; default is dry-run' })
  declare apply: boolean

  async run() {
    try {
      const report = await importReviewedQuestions(
        JSON.parse(await readFile(this.file, 'utf8')),
        this.apply
      )
      this.logger.log(JSON.stringify(report, null, 2))
      if (report.status === 'blocked') this.exitCode = 1
    } catch (error) {
      this.logger.log(
        JSON.stringify(
          {
            status: 'blocked',
            error: error instanceof Error ? error.message : String(error),
            ...('messages' in Object(error)
              ? { problems: (error as { messages: unknown }).messages }
              : {}),
          },
          null,
          2
        )
      )
      this.exitCode = 1
    }
  }
}
