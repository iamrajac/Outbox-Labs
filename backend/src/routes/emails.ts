import { Router } from "express";
import crypto from "crypto";
import { z } from "zod";
import { pool } from "../db/pool";
import { env } from "../config/env";
import { requireAuth } from "../middleware/auth";
import { enqueueEmails } from "../queue/emailQueue";
import { ensureSenders } from "../services/senders";
import { indexEmails, searchIds } from "../services/search";

export const emailsRouter = Router();
emailsRouter.use(requireAuth);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const scheduleSchema = z.object({
  subject: z.string().trim().min(1).max(300),
  body: z.string().trim().min(1).max(100_000),
  recipients: z.array(z.string().trim().toLowerCase()).min(1).max(20_000),
  startTime: z.string().datetime({ offset: true }),
  delaySeconds: z.number().min(0).max(86_400).default(0),
  hourlyLimit: z.number().int().min(1).optional(),
});

emailsRouter.post("/schedule", async (req, res) => {
  const parsed = scheduleSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
  const d = parsed.data;

  const recipients = [...new Set(d.recipients.filter((e) => EMAIL_RE.test(e)))];
  if (!recipients.length) return res.status(400).json({ error: "No valid email addresses" });

  const senders = await ensureSenders();
  const start = new Date(d.startTime).getTime();
  const delayMs = Math.round(d.delaySeconds * 1000);
  const hourlyLimit = Math.min(d.hourlyLimit ?? env.maxEmailsPerHourPerSender, env.maxEmailsPerHourPerSender);
  const batchId = crypto.randomUUID();

  const ids: string[] = [];
  const senderIds: number[] = [];
  const times: Date[] = [];
  recipients.forEach((_, i) => {
    ids.push(crypto.randomUUID());
    senderIds.push(senders[i % senders.length].id); // round-robin across the sender pool
    times.push(new Date(start + i * delayMs));
  });

  const { rows } = await pool.query(
    `INSERT INTO emails (id, user_id, sender_id, batch_id, to_email, subject, body, scheduled_at, hourly_limit, min_delay_ms)
     SELECT id, $1, sid, $2, addr, $3, $4, at, $5, $6
     FROM unnest($7::uuid[], $8::bigint[], $9::text[], $10::timestamptz[]) AS t(id, sid, addr, at)
     RETURNING *`,
    [req.user!.id, batchId, d.subject, d.body, hourlyLimit, delayMs, ids, senderIds, recipients, times],
  );

  await enqueueEmails(rows.map((r) => ({ id: r.id, scheduledAt: r.scheduled_at })));
  const emailBySender = new Map(senders.map((s) => [s.id, s.email]));
  void indexEmails(rows.map((r) => ({ ...r, sender_email: emailBySender.get(Number(r.sender_id)) })));

  res.status(201).json({
    batchId,
    scheduled: rows.length,
    skippedInvalidOrDuplicate: d.recipients.length - rows.length,
    firstSendAt: times[0],
    lastSendAt: times[times.length - 1],
  });
});

const listSchema = z.object({
  view: z.enum(["scheduled", "sent"]),
  q: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const VIEW_STATUSES = { scheduled: ["scheduled", "sending"], sent: ["sent", "failed"] } as const;

const COLS = `id, to_email AS "email", subject, status, scheduled_at AS "scheduledAt", sent_at AS "sentAt",
  preview_url AS "previewUrl", error, deferrals`;

emailsRouter.get("/", async (req, res) => {
  const parsed = listSchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: "Invalid query" });
  const { view, q, page, limit } = parsed.data;
  const statuses = [...VIEW_STATUSES[view]];
  const uid = req.user!.id;
  const order = view === "scheduled" ? "scheduled_at ASC" : "sent_at DESC NULLS LAST";

  let idFilter: string[] | null = null;
  let sqlLike: string | null = null;
  if (q) {
    idFilter = await searchIds(uid, q, statuses); // Elasticsearch first
    if (idFilter === null) sqlLike = `%${q.replace(/[%_]/g, "\\$&")}%`; // graceful fallback
  }

  const params: unknown[] = [uid, statuses];
  let where = "user_id=$1 AND status = ANY($2)";
  if (idFilter) {
    params.push(idFilter);
    where += ` AND id = ANY($${params.length}::uuid[])`;
  } else if (sqlLike) {
    params.push(sqlLike);
    where += ` AND (to_email ILIKE $${params.length} OR subject ILIKE $${params.length} OR body ILIKE $${params.length})`;
  }

  const total = await pool.query(`SELECT count(*)::int AS n FROM emails WHERE ${where}`, params);
  params.push(limit, (page - 1) * limit);
  const { rows } = await pool.query(
    `SELECT ${COLS} FROM emails WHERE ${where} ORDER BY ${order} LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  res.json({ items: rows, total: total.rows[0].n, page, limit, searchEngine: q ? (idFilter ? "elasticsearch" : "sql") : null });
});
