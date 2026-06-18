import env from '#start/env'
import SubmissionResult from '#models/submission_result'
import PracticalSubmission from '#models/practical_submission'

// TODO: The Judge0 token mapping is currently stored in memory using a Map.
// This works only while the worker process remains alive. If the process
// crashes, restarts, or is redeployed before Judge0 sends the callback,
// all token mappings will be lost and callbacks can no longer be associated
// with their corresponding submissions/test cases.
//
// Consider persisting token mappings in Redis or the database so they
// survive worker restarts and can be reliably resolved when callbacks arrive.
export async function dispatchToJudge0(
  submission: PracticalSubmission,
  testCase: any,
  problem: any,
  tokenMap: Map<string, { submissionId: number; testCaseId: number }>
) {
  const payload = {
    source_code: Buffer.from(submission.sourceCode).toString('base64'),
    language_id: languageIdFor(problem.language), // map 'java' → Judge0 language ID
    stdin: Buffer.from(testCase.input ?? '').toString('base64'),
    expected_output: Buffer.from(testCase.expectedOutput).toString('base64'),
    cpu_time_limit: problem.timeLimitMs / 1000,
    wall_time_limit: (problem.timeLimitMs / 1000) * 2,
    memory_limit: problem.memoryLimitKb,
    // ...other limits from Section 13
    callback_url: `http://worker:${env.get('CALLBACK_PORT')}/judge0-callback`,
    base64_encoded: true,
  }

  const response = await fetch(`${env.get('JUDGE0_URL')}/submissions?base64_encoded=true`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Auth-Token': env.get('JUDGE0_SECRET'),
    },
    body: JSON.stringify(payload),
  })

  const { token } = (await response.json()) as { token: string }

  // Map the Judge0 token back to (submissionId, testCaseId) for when the callback arrives
  tokenMap.set(token, { submissionId: submission.id, testCaseId: testCase.id })
}

// Helper to get the code language ID
// Look into: https://ce.judge0.com/#statuses-and-languages-active-and-archived-languages-get
// Different versions can be used/installed in the self-hosted Judge0 instance
function languageIdFor(language: string): number {
  const map: Record<string, number> = {
    java: 62,
    c: 50,
  }
  const id = map[language]
  if (!id) throw new Error(`Unsupported language: ${language}`)
  return id
}

export async function finalizeSubmission(submissionId: number) {
  const results = await SubmissionResult.query().where('submissionId', submissionId)
  const submission = await PracticalSubmission.findOrFail(submissionId)

  const verdicts = results.map((r: SubmissionResult) => r.verdict)

  let status: string
  if (verdicts.some((v: string) => v === 'Time Limit Exceeded')) status = 'timeout'
  else if (verdicts.some((v: string) => v !== 'Accepted')) status = 'wrong_answer'
  else status = 'accepted'

  await submission.merge({ status }).save()
}
