import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { ExpressAdapter } from "@bull-board/express";
import { env } from "./config/env";
import { migrate } from "./db/migrate";
import { emailQueue } from "./queue/emailQueue";
import { reconcileQueue } from "./queue/reconcile";
import { startWorker } from "./queue/worker";
import { authRouter } from "./routes/auth";
import { emailsRouter } from "./routes/emails";
import { slackRouter } from "./routes/slack";
import { requireAuth } from "./middleware/auth";
import { ensureSenders } from "./services/senders";
import { reindexAll } from "./services/search";
import { logger } from "./utils/logger";

async function main() {
  await migrate();
  await ensureSenders();

  const app = express();
  app.use(cors({ origin: env.frontendUrl, credentials: true }));
  app.use(express.json({ limit: "5mb" }));
  app.use(cookieParser());

  app.get("/api/health", (_req, res) => res.json({ ok: true }));
  app.use("/api/auth", authRouter);
  app.use("/api/emails", emailsRouter);
  app.use("/api/slack", slackRouter);

  // Live BullMQ dashboard (behind the same login as the app).
  const board = new ExpressAdapter();
  board.setBasePath("/admin/queues");
  createBullBoard({ queues: [new BullMQAdapter(emailQueue)], serverAdapter: board });
  app.use("/admin/queues", requireAuth, board.getRouter());

  app.listen(env.port, () => logger.info(`API listening on :${env.port}`));

  void reindexAll();
  if (process.env.EMBEDDED_WORKER === "true") {
    await reconcileQueue();
    startWorker();
  }
}

main().catch((err) => {
  logger.error(err);
  process.exit(1);
});
