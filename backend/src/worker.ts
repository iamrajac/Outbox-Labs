import { migrate } from "./db/migrate";
import { ensureSenders } from "./services/senders";
import { reconcileQueue } from "./queue/reconcile";
import { startWorker } from "./queue/worker";
import { logger } from "./utils/logger";

async function main() {
  await migrate();
  await ensureSenders();
  await reconcileQueue();
  const worker = startWorker();
  const stop = async () => {
    logger.info("shutting down worker (finishing in-flight jobs)");
    await worker.close(); // waits for active jobs; unfinished ones are safely retried by BullMQ
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

main().catch((err) => {
  logger.error(err);
  process.exit(1);
});
