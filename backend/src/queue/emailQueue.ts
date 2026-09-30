import { Queue } from "bullmq";
import { env } from "../config/env";
import { redis } from "./redis";

export interface EmailJobData {
  emailId: string;
  /** Slot handed out by the rate limiter; lets a delayed job skip re-reserving when it wakes. */
  reservation?: { slot: number };
}

export const emailQueue = new Queue<EmailJobData>(env.queueName, {
  connection: redis,
  defaultJobOptions: {
    attempts: env.maxSendAttempts,
    backoff: { type: "exponential", delay: 5_000 },
    removeOnComplete: { age: 24 * 3600, count: 10_000 },
    removeOnFail: { age: 7 * 24 * 3600 },
  },
});

export interface EnqueueItem {
  id: string;
  scheduledAt: Date;
}

/**
 * Enqueue delayed jobs. jobId === email row id, so calling this twice for the same
 * email is a no-op in Redis: BullMQ ignores a job whose id already exists.
 */
export async function enqueueEmails(items: EnqueueItem[], chunk = 500): Promise<void> {
  const now = Date.now();
  for (let i = 0; i < items.length; i += chunk) {
    await emailQueue.addBulk(
      items.slice(i, i + chunk).map((it) => ({
        name: "send",
        data: { emailId: it.id },
        opts: { jobId: it.id, delay: Math.max(0, it.scheduledAt.getTime() - now) },
      })),
    );
  }
}
