import env from '#start/env'
import { BaseCommand } from '@adonisjs/core/ace'
import { Worker } from 'bullmq'
import http from 'node:http'
import { redisConnection } from '#services/submission_queue'
import { dispatchToJudge0, finalizeSubmission } from '#services/judge0_service'
import PracticalSubmission from '#models/practical_submission'
import SubmissionResult from '#models/submission_result'
import TestCase from '#models/test_case'

// TODO: Worker and HTTP callback server are tightly coupled in the same process.
// This reduces fault isolation and prevents independent scaling.
// Future improvement: split into separate services (queue worker service + callback API service).

// Shared state between processJob and handleCallback
// TODO: pendingCallbacks and deadlines are stored in memory.
// This breaks on process restart, crashes, or horizontal scaling (multiple workers).
// Future improvement: move state tracking to Redis or persistent storage
// to ensure callback reconciliation survives process restarts and supports scaling.
const pendingCallbacks = new Map<number, Set<number>>()
const deadlines = new Map<number, ReturnType<typeof setTimeout>>()
// TODO: tokenMap is globally shared in memory across all submissions.
// This can cause memory leaks and breaks in distributed/multi-instance setups.
// Future improvement: persist Judge0 token → submission/testCase mapping in Redis or DB
// with TTL-based cleanup.
const tokenMap = new Map<string, { submissionId: number; testCaseId: number }>()

export default class QueueWork extends BaseCommand {
  static commandName = 'queue:work'
  static description = 'Start the submission worker and callback listener'

  async run() {
    // 1. BullMQ consumer
    const worker = new Worker(
      'code-submissions',
      async (job) => {
        await this.processJob(job.data.submissionId)
      },
      {
        connection: redisConnection,
        concurrency: env.get('WORKER_CONCURRENCY'),
      }
    )

    worker.on('failed', (job, err) => {
      this.logger.error(`Job ${job?.id} failed: ${err.message}`)
    })

    // 2. Callback listener
    const server = http.createServer((req, res) => {
      this.handleCallback(req, res)
    })
    server.listen(env.get('CALLBACK_PORT'))
    this.logger.info('Worker and callback listener running')

    // Keep the process alive
    await new Promise(() => {})
  }

  private async processJob(submissionId: number) {
    const submission = await PracticalSubmission.findOrFail(submissionId)
    const problem = await submission.related('problem').query().firstOrFail()
    const testCases = await problem.related('testCases').query()

    await submission.merge({ status: 'running' }).save()

    // Track how many callbacks are still outstanding
    pendingCallbacks.set(submissionId, new Set(testCases.map((tc: TestCase) => tc.id)))

    // Set a timeout — if callbacks don't all arrive, resolve to error
    // TODO: Submission timeout logic assumes all test cases complete within a fixed window.
    // This does not handle partial completion, delayed callbacks, or uneven execution times.
    // Future improvement: implement per-test-case timeout tracking and more granular state recovery
    // instead of global submission-level timeout fallback.
    const deadline = setTimeout(async () => {
      if (pendingCallbacks.has(submissionId)) {
        pendingCallbacks.delete(submissionId)
        await submission.merge({ status: 'error' }).save()
      }
    }, problem.timeLimitMs + 30_000) // wall limit + generous buffer

    deadlines.set(submissionId, deadline)

    // TODO: Currently dispatches test cases sequentially (await inside loop).
    // This is safe but suboptimal for performance.
    // Future improvement: dispatch in parallel using Promise.all or a controlled concurrency pool
    // to reduce total Judge0 submission time under load.
    for (const testCase of testCases) {
      // TODO: dispatchToJudge0 has no retry mechanism on network/API failure.
      // Future improvement: add retry logic (BullMQ retries or exponential backoff)
      // to handle transient Judge0 or network failures without losing test execution.
      await dispatchToJudge0(submission, testCase, problem, tokenMap)
    }
  }

  private async handleCallback(req: http.IncomingMessage, res: http.ServerResponse) {
    if (req.method !== 'PUT' || req.url !== '/judge0-callback') {
      res.writeHead(404).end()
      return
    }

    const body = await this.readBody(req)
    const result = JSON.parse(body)
    const token = result.token
    const mapped = tokenMap.get(token)

    if (!mapped) {
      res.writeHead(400).end()
      return
    }
    res.writeHead(200).end()

    const { submissionId, testCaseId } = mapped
    tokenMap.delete(token)

    await SubmissionResult.create({
      submissionId,
      testCaseId,
      verdict: result.status?.description ?? 'Unknown',
      stdout: result.stdout ? Buffer.from(result.stdout, 'base64').toString() : null,
      stderr: result.stderr ? Buffer.from(result.stderr, 'base64').toString() : null,
      timeMs: result.time ? Math.round(result.time * 1000) : null,
      memoryKb: result.memory ?? null,
    })

    // Remove this test case from the pending set
    const pending = pendingCallbacks.get(submissionId)
    if (!pending) return // timeout already resolved this submission

    pending.delete(testCaseId)

    if (pending.size === 0) {
      // All test cases reported — finalize
      pendingCallbacks.delete(submissionId)
      const dl = deadlines.get(submissionId)
      if (dl) {
        clearTimeout(dl)
      }
      deadlines.delete(submissionId)
      await finalizeSubmission(submissionId)
    }
  }

  // Utility — reads the full request body as a string
  private readBody(req: http.IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      let data = ''
      req.on('data', (chunk) => (data += chunk))
      req.on('end', () => resolve(data))
      req.on('error', reject)
    })
  }
}
