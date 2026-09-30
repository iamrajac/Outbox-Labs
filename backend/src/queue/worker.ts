import { Worker } from "bullmq";
import { env } from "../config/env";
import { createRedis } from "./redis";
import { EmailJobData } from "./emailQueue";
import { processEmailJob } from "./processor";
import { logger } from "../utils/logger";

export function startWorker(): Worker<EmailJobData> {
  const worker = new Worker<EmailJobData>(env.queueName, processEmailJob, {
    connection: createRedis(),
    concurrency: env.workerConcurrency,
  });
  worker.on("failed", (job, err) => logger.warn({ jobId: job?.id, err: err.message }, "job attempt failed"));
  worker.on("error", (err) => logger.error({ err: err.message }, "worker error"));
  logger.info({ concurrency: env.workerConcurrency }, "worker started");
  return worker;
}
