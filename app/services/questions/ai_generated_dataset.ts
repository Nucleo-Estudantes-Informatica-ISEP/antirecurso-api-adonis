import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

export const MAX_ANSWERS_PER_QUESTION = 9

export type AiGeneratedQuestion = {
  question: string
  answers: string[]
  correct_index: number
  source: 'AI_GENERATED'
  in_plan?: boolean
  ref?: string
}

export class InvalidAiGeneratedDatasetError extends Error {
  constructor(public readonly problems: string[]) {
    super(
      `Invalid AI-generated question dataset (${problems.length} problem${problems.length === 1 ? '' : 's'}):\n` +
        problems.map((problem) => `  - ${problem}`).join('\n')
    )
    this.name = 'InvalidAiGeneratedDatasetError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function getAiGeneratedQuestionProblems(record: unknown): string[] {
  if (!isRecord(record)) return ['record is not an object']

  const problems: string[] = []
  const { question, answers, correct_index: correctIndex, source, ref } = record
  const inPlan = record.in_plan

  if (typeof question !== 'string' || question.trim().length === 0) {
    problems.push('question must be a non-empty string')
  }

  if (!Array.isArray(answers) || answers.length < 2 || answers.length > MAX_ANSWERS_PER_QUESTION) {
    problems.push(`answers must be an array of 2 to ${MAX_ANSWERS_PER_QUESTION} strings`)
  } else {
    answers.forEach((answer, index) => {
      if (typeof answer !== 'string' || answer.trim().length === 0) {
        problems.push(`answer ${index} must be a non-empty string`)
      }
    })

    if (new Set(answers).size !== answers.length) problems.push('answers must be unique')

    if (!Number.isInteger(correctIndex) || (correctIndex as number) < 0) {
      problems.push('correct_index must be a non-negative integer')
    } else if ((correctIndex as number) >= answers.length) {
      problems.push(`correct_index ${correctIndex} is outside the ${answers.length} answers`)
    }
  }

  if (source !== 'AI_GENERATED') problems.push('source must be AI_GENERATED')
  if (inPlan !== undefined && typeof inPlan !== 'boolean') problems.push('in_plan must be boolean')
  if (ref !== undefined && typeof ref !== 'string') problems.push('ref must be a string')

  return problems
}

export async function loadAiGeneratedSubjectQuestions(
  directory: string
): Promise<AiGeneratedQuestion[]> {
  const directoryEntries = await readdir(directory)
  const fileNames = directoryEntries.filter((name) => name.endsWith('.json')).sort()
  const questions: AiGeneratedQuestion[] = []
  const problems: string[] = []
  const seenQuestions = new Map<string, string>()

  for (const fileName of fileNames) {
    let records: unknown
    try {
      records = JSON.parse(await readFile(join(directory, fileName), 'utf8'))
    } catch (error) {
      problems.push(`${fileName}: ${error instanceof Error ? error.message : 'unreadable JSON'}`)
      continue
    }

    if (!Array.isArray(records)) {
      problems.push(`${fileName}: top-level value must be an array`)
      continue
    }

    records.forEach((record, index) => {
      const location = `${fileName}#${index}`
      const recordProblems = getAiGeneratedQuestionProblems(record)
      recordProblems.forEach((problem) => problems.push(`${location}: ${problem}`))
      if (recordProblems.length > 0) return

      const valid = record as AiGeneratedQuestion
      const firstLocation = seenQuestions.get(valid.question)
      if (firstLocation) {
        problems.push(`${location}: duplicate question text, first seen at ${firstLocation}`)
        return
      }

      seenQuestions.set(valid.question, location)
      questions.push(valid)
    })
  }

  if (problems.length > 0) throw new InvalidAiGeneratedDatasetError(problems)

  return questions
}

export async function listAiGeneratedSubjects(rootDirectory: string): Promise<string[]> {
  const entries = await readdir(rootDirectory, { withFileTypes: true })
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
}
