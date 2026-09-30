import { DelayedError, Job } from "bullmq";
import { getTestMessageUrl } from "nodemailer";
import { pool } from "../db/pool";
import { env } from "../config/env";
import { logger } from "../utils/logger";
import { EmailJobData } from "./emailQueue";
import { reserveSlot } from "./rateLimiter";
import { getSender, transportFor } from "../services/senders";
import { indexEmailById } from "../services/search";
import { notifySlack } from "../services/slack";

/** Waits shorter than this stay inside the worker; longer ones go back to BullMQ as delayed jobs. */
const INLINE_WAIT_MS = 5_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface EmailRow {
  id: string;
  user_id: string;
  sender_id: string;
  to_email: string;
  subject: string;
  body: string;
  status: string;
  hourly_limit: number;
  attempts: number;
}

async function park(job: Job<EmailJobData>, token: string | undefined, until: number): Promise<never> {
  await job.moveToDelayed(until, token);
  throw new DelayedError();
}

export async function processEmailJob(job: Job<EmailJobData>, token?: string): Promise<void> {
  const { emailId } = job.data;

  const { rows } = await pool.query<EmailRow>("SELECT * FROM emails WHERE id=$1", [emailId]);
  const email = rows[0];
  if (!email || email.status === "sent" || email.status === "failed") return; // idempotent no-op

  // ---- 1. rate limit + pacing (Redis, atomic, shared by every worker) ----
  const senderId = Number(email.sender_id);
  let slot = job.data.reservation?.slot;
  if (slot === undefined) {
    const r = await reserveSlot(senderId, email.hourly_limit);
    if (!r.ok) {
      await pool.query("UPDATE emails SET deferrals = deferrals + 1 WHERE id=$1", [emailId]);
      if (r.firstHitInWindow) await announceLimitHit(email, r.windowStart);
      logger.info({ emailId, senderId, retryAt: new Date(r.retryAt).toISOString() }, "hourly limit hit; deferred");
      return park(job, token, r.retryAt);
    }
    slot = r.slot;
  }
  const wait = slot - Date.now();
  if (wait > INLINE_WAIT_MS) {
    await job.updateData({ ...job.data, reservation: { slot } });
    return park(job, token, slot);
  }
  if (wait > 0) await sleep(wait);

  // ---- 2. claim the row: only one worker may ever send a given email ----
  const claim = await pool.query<EmailRow>(
    `UPDATE emails SET status='sending', locked_at=now(), attempts=attempts+1
     WHERE id=$1 AND (status='scheduled' OR (status='sending' AND locked_at < now() - ($2 || ' milliseconds')::interval))
     RETURNING *`,
    [emailId, String(env.sendingLockMs)],
  );
  if (!claim.rows[0]) return; // someone else owns it or it is finished

  // ---- 3. send ----
  try {
    const sender = await getSender(senderId);
    const info = await transportFor(sender).sendMail({
      from: sender.email,
      to: email.to_email,
      subject: email.subject,
      text: email.body,
      messageId: `<${email.id}@outbox-scheduler.local>`, // stable id: a re-send is recognisable downstream
    });
    const preview = env.mailTransport === "ethereal" ? getTestMessageUrl(info) || null : null;
    await pool.query(
      `UPDATE emails SET status='sent', sent_at=now(), locked_at=NULL, error=NULL, preview_url=$2, message_id=$3 WHERE id=$1`,
      [emailId, preview, info.messageId],
    );
    await indexEmailById(emailId);
  } catch (err) {
    const message = (err as Error).message.slice(0, 500);
    const attempts = claim.rows[0].attempts;
    if (attempts >= env.maxSendAttempts) {
      await pool.query(`UPDATE emails SET status='failed', locked_at=NULL, error=$2, sent_at=now() WHERE id=$1`, [
        emailId,
        message,
      ]);
      await indexEmailById(emailId);
      logger.error({ emailId, err: message }, "email failed permanently");
      return;
    }
    await pool.query(`UPDATE emails SET status='scheduled', locked_at=NULL, error=$2 WHERE id=$1`, [emailId, message]);
    await job.updateData({ emailId }); // drop the used reservation; a retry reserves again
    throw err; // BullMQ retries with exponential backoff
  }
}

async function announceLimitHit(email: EmailRow, windowStart: number): Promise<void> {
  const sender = await getSender(Number(email.sender_id));
  const resumes = new Date(windowStart + 3_600_000).toISOString();
  const limit = Math.min(email.hourly_limit, env.maxEmailsPerHourPerSender);
  await notifySlack(
    Number(email.user_id),
    `:warning: *Hourly send limit reached* for sender \`${sender.email}\` (${limit}/hour). ` +
      `Remaining emails are queued, not dropped, and resume after ${resumes}.`,
  );
}
