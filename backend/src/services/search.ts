import { Client } from "@elastic/elasticsearch";
import { env } from "../config/env";
import { pool } from "../db/pool";
import { logger } from "../utils/logger";

const INDEX = "emails";
const es = new Client({ node: env.elasticUrl, requestTimeout: 5000, maxRetries: 1 });

export interface EmailDoc {
  id: string;
  user_id: number;
  to_email: string;
  subject: string;
  body: string;
  status: string;
  scheduled_at: string;
  sent_at: string | null;
  sender_email?: string;
}

let ready = false;

export async function ensureIndex(): Promise<boolean> {
  try {
    const exists = await es.indices.exists({ index: INDEX });
    if (!exists) {
      await es.indices.create({
        index: INDEX,
        mappings: {
          properties: {
            user_id: { type: "long" },
            to_email: { type: "text", fields: { raw: { type: "keyword" } } },
            subject: { type: "text" },
            body: { type: "text" },
            status: { type: "keyword" },
            scheduled_at: { type: "date" },
            sent_at: { type: "date" },
            sender_email: { type: "keyword" },
          },
        },
      });
    }
    ready = true;
  } catch (err) {
    ready = false;
    logger.warn({ err: (err as Error).message }, "Elasticsearch unavailable; falling back to SQL search");
  }
  return ready;
}

const toDoc = (r: any): EmailDoc => ({
  id: r.id,
  user_id: Number(r.user_id),
  to_email: r.to_email,
  subject: r.subject,
  body: r.body,
  status: r.status,
  scheduled_at: new Date(r.scheduled_at).toISOString(),
  sent_at: r.sent_at ? new Date(r.sent_at).toISOString() : null,
  sender_email: r.sender_email,
});

/** Index or refresh emails by id (idempotent upsert). Never throws: search is not the source of truth. */
export async function indexEmails(rows: any[]): Promise<void> {
  if (!rows.length) return;
  try {
    if (!ready && !(await ensureIndex())) return;
    const operations = rows.flatMap((r) => [{ index: { _index: INDEX, _id: r.id } }, toDoc(r)]);
    const res = await es.bulk({ operations, refresh: false });
    if (res.errors) logger.warn("some documents failed to index");
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "indexing failed");
  }
}

export async function indexEmailById(id: string): Promise<void> {
  const { rows } = await pool.query(
    "SELECT e.*, s.email AS sender_email FROM emails e JOIN senders s ON s.id=e.sender_id WHERE e.id=$1",
    [id],
  );
  await indexEmails(rows);
}

/** Rebuild the index from Postgres in the background (runs at API boot; safe to repeat). */
export async function reindexAll(): Promise<void> {
  if (!(await ensureIndex())) return;
  let lastId = "00000000-0000-0000-0000-000000000000";
  for (;;) {
    const { rows } = await pool.query(
      `SELECT e.*, s.email AS sender_email FROM emails e JOIN senders s ON s.id=e.sender_id
       WHERE e.id > $1 ORDER BY e.id LIMIT 1000`,
      [lastId],
    );
    if (!rows.length) break;
    await indexEmails(rows);
    lastId = rows[rows.length - 1].id;
  }
  logger.info("search reindex complete");
}

/** Returns matching email ids for a user, or null if Elasticsearch cannot answer. */
export async function searchIds(userId: number, q: string, statuses: string[], size = 200): Promise<string[] | null> {
  try {
    if (!ready && !(await ensureIndex())) return null;
    const res = await es.search<EmailDoc>({
      index: INDEX,
      size,
      _source: false,
      query: {
        bool: {
          filter: [{ term: { user_id: userId } }, { terms: { status: statuses } }],
          must: [
            {
              multi_match: {
                query: q,
                fields: ["to_email^3", "subject^2", "body"],
                fuzziness: "AUTO",
                operator: "or",
              },
            },
          ],
        },
      },
    });
    return res.hits.hits.map((h) => h._id as string);
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "search failed, falling back to SQL");
    return null;
  }
}
