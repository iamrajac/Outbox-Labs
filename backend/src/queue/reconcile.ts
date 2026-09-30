import { pool } from "../db/pool";
import { enqueueEmails } from "./emailQueue";
import { logger } from "../utils/logger";

/**
 * Boot-time safety net. Postgres is the source of truth: every unsent email is
 * (re)offered to BullMQ. Because jobId === email id, jobs that already exist in Redis
 * are ignored, so this only fills gaps (e.g. Redis was flushed or lost its AOF tail).
 */
export async function reconcileQueue(): Promise<number> {
  let total = 0;
  let last = "00000000-0000-0000-0000-000000000000";
  for (;;) {
    const { rows } = await pool.query(
      `SELECT id, scheduled_at FROM emails WHERE status IN ('scheduled','sending') AND id > $1
       ORDER BY id LIMIT 2000`,
      [last],
    );
    if (!rows.length) break;
    await enqueueEmails(rows.map((r) => ({ id: r.id, scheduledAt: r.scheduled_at })));
    total += rows.length;
    last = rows[rows.length - 1].id;
  }
  logger.info({ total }, "queue reconciled with database");
  return total;
}
