// app/services/submission_queue.ts
import env from '#start/env'
import { Queue } from 'bullmq'
import { Redis } from 'ioredis'

export const redisConnection = new Redis({
  host: env.get('REDIS_HOST'),
  port: env.get('REDIS_PORT'),
  password: env.get('REDIS_PASSWORD', ''),
  maxRetriesPerRequest: null, // required by BullMQ
})

export const submissionQueue = new Queue('code-submissions', {
  connection: redisConnection,
})
