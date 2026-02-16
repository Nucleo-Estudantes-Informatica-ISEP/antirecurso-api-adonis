import Answer from '#models/answer'
import AnswerQuestion from '#models/answer_question'
import Question from '#models/question'
import Subject from '#models/subject'
import { DEFAULT_EXAM_RULE, type ExamMode, getSubjectExamRule } from '#services/exams/exam_config'

export type GeneratedQuestionOption = {
  name: string
  order: string
}

export type GeneratedQuestion = {
  id: number
  question: string
  exam: string
  image: string
  question_type: string
  options: GeneratedQuestionOption[]
}

export type GenerateExamParams = {
  subject: Subject
  mode: ExamMode
  userId: number | null
  nOfQuestions: number | null
  filter: string | null
}

export default class ExamGenerationService {
  async generate(params: GenerateExamParams): Promise<GeneratedQuestion[]> {
    let selectedQuestions: Question[] = []

    if (params.mode === 'realistic') {
      selectedQuestions = await this.generateRealistic(params.subject)
    } else if (params.mode === 'new') {
      selectedQuestions = await this.generateNew(
        params.subject.id,
        params.userId!,
        DEFAULT_EXAM_RULE.n_of_questions
      )
    } else if (params.mode === 'wrong') {
      selectedQuestions = await this.generateWrong(
        params.subject.id,
        params.userId!,
        DEFAULT_EXAM_RULE.n_of_questions
      )
    } else if (params.mode === 'hard') {
      selectedQuestions = await this.generateHard(
        params.subject.id,
        DEFAULT_EXAM_RULE.n_of_questions
      )
    } else if (params.mode === 'custom') {
      selectedQuestions = await this.generateCustom(
        params.subject.id,
        params.userId!,
        params.nOfQuestions!,
        params.filter
      )
    } else {
      selectedQuestions = await this.generateDefault(params.subject.id)
    }

    return this.serializeQuestions(this.shuffle(selectedQuestions))
  }

  private async generateDefault(subjectId: number): Promise<Question[]> {
    const eligibleQuestions = await this.loadEligibleQuestions(
      subjectId,
      DEFAULT_EXAM_RULE.minimum_options
    )
    return this.takeRandom(eligibleQuestions, DEFAULT_EXAM_RULE.n_of_questions)
  }

  private async generateRealistic(subject: Subject): Promise<Question[]> {
    const subjectRule = getSubjectExamRule(subject.slug)
    const eligibleQuestions = await this.loadEligibleQuestions(
      subject.id,
      subjectRule.minimum_options
    )
    return this.takeRandom(eligibleQuestions, subjectRule.n_of_questions)
  }

  private async generateNew(
    subjectId: number,
    userId: number,
    nOfQuestions: number
  ): Promise<Question[]> {
    const eligibleQuestions = await this.loadEligibleQuestions(
      subjectId,
      DEFAULT_EXAM_RULE.minimum_options
    )
    const answeredQuestionIds = await this.getAnsweredQuestionIds(userId, subjectId)

    const unseenQuestions = eligibleQuestions.filter(
      (question) => !answeredQuestionIds.has(question.id)
    )
    return this.fillFromPools(unseenQuestions, eligibleQuestions, nOfQuestions)
  }

  private async generateWrong(
    subjectId: number,
    userId: number,
    nOfQuestions: number
  ): Promise<Question[]> {
    const eligibleQuestions = await this.loadEligibleQuestions(
      subjectId,
      DEFAULT_EXAM_RULE.minimum_options
    )
    const latestQuestionStatus = await this.getLatestQuestionWrongStatus(userId, subjectId)

    const wrongQuestions = eligibleQuestions.filter(
      (question) => latestQuestionStatus.get(question.id) === true
    )
    return this.fillFromPools(wrongQuestions, eligibleQuestions, nOfQuestions)
  }

  private async generateHard(subjectId: number, nOfQuestions: number): Promise<Question[]> {
    const eligibleQuestions = await this.loadEligibleQuestions(
      subjectId,
      DEFAULT_EXAM_RULE.minimum_options
    )

    const wrongCountByQuestion = await this.getWrongCountByQuestion(subjectId)
    if (wrongCountByQuestion.size === 0) {
      return this.takeRandom(eligibleQuestions, nOfQuestions)
    }

    const totalSubjectQuestions = await this.getSubjectQuestionCount(subjectId)
    const hardPoolSize = Math.max(1, Math.floor(totalSubjectQuestions / 2))

    const hardestQuestionIds = [...wrongCountByQuestion.entries()]
      .sort((left, right) => right[1] - left[1])
      .slice(0, hardPoolSize)
      .map(([questionId]) => questionId)

    const hardestQuestionIdSet = new Set(hardestQuestionIds)
    const hardestQuestions = eligibleQuestions.filter((question) =>
      hardestQuestionIdSet.has(question.id)
    )

    return this.fillFromPools(hardestQuestions, eligibleQuestions, nOfQuestions)
  }

  private async generateCustom(
    subjectId: number,
    userId: number,
    nOfQuestions: number,
    filter: string | null
  ): Promise<Question[]> {
    if (filter === 'new') {
      return this.generateNew(subjectId, userId, nOfQuestions)
    }

    const eligibleQuestions = await this.loadEligibleQuestions(
      subjectId,
      DEFAULT_EXAM_RULE.minimum_options
    )
    return this.takeRandom(eligibleQuestions, nOfQuestions)
  }

  private async loadEligibleQuestions(
    subjectId: number,
    minimumOptions: number
  ): Promise<Question[]> {
    const questions = await Question.query()
      .where('subjectId', subjectId)
      .preload('options')
      .preload('questionType')

    return questions.filter((question) => question.options.length >= minimumOptions)
  }

  private async getAnsweredQuestionIds(userId: number, subjectId: number): Promise<Set<number>> {
    const answers = await Answer.query()
      .where('userId', userId)
      .where('subjectId', subjectId)
      .select(['id'])

    if (answers.length === 0) {
      return new Set()
    }

    const answerQuestions = await AnswerQuestion.query()
      .whereIn(
        'answerId',
        answers.map((answer) => answer.id)
      )
      .select(['questionId'])

    return new Set(answerQuestions.map((answerQuestion) => answerQuestion.questionId))
  }

  private async getLatestQuestionWrongStatus(
    userId: number,
    subjectId: number
  ): Promise<Map<number, boolean>> {
    const answerQuestions = await AnswerQuestion.query()
      .whereHas('answer', (query) => {
        query.where('userId', userId).where('subjectId', subjectId)
      })
      .orderBy('id', 'asc')
      .select(['questionId', 'isWrong'])

    const statusByQuestion = new Map<number, boolean>()
    for (const answerQuestion of answerQuestions) {
      statusByQuestion.set(answerQuestion.questionId, answerQuestion.isWrong)
    }

    return statusByQuestion
  }

  private async getWrongCountByQuestion(subjectId: number): Promise<Map<number, number>> {
    const answerQuestions = await AnswerQuestion.query()
      .whereHas('answer', (query) => {
        query.where('subjectId', subjectId)
      })
      .select(['questionId', 'isWrong'])

    const wrongCountByQuestion = new Map<number, number>()
    for (const answerQuestion of answerQuestions) {
      if (!answerQuestion.isWrong) {
        continue
      }

      wrongCountByQuestion.set(
        answerQuestion.questionId,
        (wrongCountByQuestion.get(answerQuestion.questionId) ?? 0) + 1
      )
    }

    return wrongCountByQuestion
  }

  private async getSubjectQuestionCount(subjectId: number): Promise<number> {
    const queryResult = await Question.query().where('subjectId', subjectId).count('* as total')
    const total = queryResult[0].$extras.total
    return Number(total)
  }

  private fillFromPools(
    primaryPool: Question[],
    fallbackPool: Question[],
    targetSize: number
  ): Question[] {
    const selectedPrimaryQuestions = this.takeRandom(primaryPool, targetSize)

    if (selectedPrimaryQuestions.length >= targetSize) {
      return selectedPrimaryQuestions
    }

    const selectedQuestionIds = new Set(selectedPrimaryQuestions.map((question) => question.id))
    const fallbackQuestions = fallbackPool.filter(
      (question) => !selectedQuestionIds.has(question.id)
    )

    return [
      ...selectedPrimaryQuestions,
      ...this.takeRandom(fallbackQuestions, targetSize - selectedPrimaryQuestions.length),
    ]
  }

  private serializeQuestions(questions: Question[]): GeneratedQuestion[] {
    return questions.map((question) => ({
      id: question.id,
      question: question.question,
      exam: question.exam,
      image: question.image,
      question_type: question.questionType.name,
      options: this.shuffle(question.options).map((option) => ({
        name: option.name,
        order: option.order,
      })),
    }))
  }

  private takeRandom<T>(items: T[], count: number): T[] {
    return this.shuffle(items).slice(0, count)
  }

  private shuffle<T>(items: T[]): T[] {
    return [...items].sort(() => Math.random() - 0.5)
  }
}
