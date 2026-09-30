# Outbox Scheduler

A full-stack email job scheduler: an Express + BullMQ service that schedules, throttles and sends emails
(via Ethereal SMTP), and a React dashboard to compose campaigns and watch them go out.

```
backend/    Express API, BullMQ worker, Postgres, Redis rate limiter, Elasticsearch, Slack
frontend/   React + TypeScript + Tailwind (Vite)
docker-compose.yml   Postgres, Redis (AOF on), Elasticsearch
```

## Running it

Prerequisites: Node 20+, Docker (for Postgres / Redis / Elasticsearch).

```bash
docker compose up -d                   # postgres:5432, redis:6379, elasticsearch:9200

# backend
cd backend
cp .env.example .env                   # then fill in the Google / Slack credentials
npm install
npm run dev                            # API + BullMQ dashboard on :4000
npm run dev:worker                     # the worker, in a second terminal (or set EMBEDDED_WORKER=true)

# frontend
cd ../frontend
npm install
npm run dev                            # http://localhost:5173
```

Production style: `npm run build && npm start` and `npm run start:worker` in `backend/`.
Run `npm test` in `backend/` for the rate-limiter tests (needs the local Redis).

### Environment variables (`backend/.env`)

| Variable | Default | Meaning |
|---|---|---|
| `DATABASE_URL`, `REDIS_URL`, `ELASTICSEARCH_URL` | localhost | Backing services |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | – | Google OAuth login |
| `SLACK_CLIENT_ID` / `SLACK_CLIENT_SECRET` | – | Slack OAuth ("Connect Slack") |
| `PUBLIC_URL`, `FRONTEND_URL` | `http://localhost:5173` | Browser-facing origin (OAuth redirects are built from it) |
| `SENDER_COUNT` | `3` | Number of Ethereal sender identities in the pool |
| `WORKER_CONCURRENCY` | `5` | Parallel jobs per worker process |
| `MIN_DELAY_BETWEEN_EMAILS_MS` | `2000` | **Minimum gap between two sends from one sender** |
| `MAX_EMAILS_PER_HOUR_PER_SENDER` | `200` | Hourly quota per sender (also the cap for the compose form's "Hourly limit") |
| `MAX_SEND_ATTEMPTS` | `3` | SMTP retries (exponential backoff) before an email is marked `failed` |

### Ethereal
Nothing to set up by hand: on first boot the backend calls `nodemailer.createTestAccount()`
`SENDER_COUNT` times and stores the SMTP credentials in the `senders` table. Every sent email
stores its Ethereal **preview URL**, shown as a "preview" link in the Sent tab.

### Google OAuth
Google Cloud Console → Credentials → OAuth client (Web). Authorized redirect URI:
`http://localhost:5173/api/auth/google/callback`.

### Slack OAuth
api.slack.com/apps → create an app → *OAuth & Permissions*: add redirect URL
`http://localhost:5173/api/slack/callback` (Slack requires HTTPS for non-localhost URLs — use a tunnel such as ngrok
and set `PUBLIC_URL` accordingly) and add the **`incoming-webhook`** bot scope. Click *Connect Slack* in the
dashboard, pick a channel, and the webhook is stored per user.

## Architecture

```
 React ──/api──▶ Express ──INSERT──▶ Postgres (source of truth)
                    │
                    └──addBulk(delay = scheduledAt-now, jobId = emailId)──▶ Redis / BullMQ
                                                                               │
                        BullMQ worker(s) ◀─────────────────────────────────────┘
                          1. reserve slot  (Redis Lua: hourly quota + pacing)
                          2. claim row     (Postgres atomic UPDATE)
                          3. send (Ethereal SMTP) → mark sent → index in Elasticsearch
```

### How scheduling works
`POST /api/emails/schedule` validates and de-duplicates the recipients, assigns each to a sender round-robin,
inserts one row per email (`scheduled_at = start + i × delay`) in a single SQL statement and enqueues one **BullMQ
delayed job** per row. There is no cron of any kind: Redis holds each job in a sorted set keyed by its due time
and BullMQ promotes it when the time arrives.

### Persistence across restarts
* Jobs live in Redis (started with AOF), the emails and their state live in Postgres. Nothing is held in process memory.
* Stop the API/worker and start it again: delayed jobs are still in Redis and fire at their original time;
  sent emails are already `sent` in Postgres and are never re-enqueued.
* On boot, `reconcileQueue()` re-offers every unsent row to BullMQ. Because `jobId = email id`, existing jobs are
  ignored, so it only fills gaps (e.g. Redis was wiped). Verified with `kill -9` mid-campaign.

### Idempotency (no duplicate sends)
1. `jobId` = email UUID → an email can exist at most once in the queue.
2. Before sending, the worker atomically claims the row:
   `UPDATE … SET status='sending' WHERE id=$1 AND status='scheduled'` (or a stale `sending` lock older than
   `SENDING_LOCK_MS`). Only one worker can win; every other attempt exits silently.
3. Finished rows (`sent`/`failed`) short-circuit at the top of the processor.
4. Each message carries a stable `Message-ID` derived from the email id.

Residual risk (documented trade-off): a crash in the milliseconds between SMTP acceptance and the DB update
can lead to one re-send after the lock expires — inherent to any at-least-once queue with a non-transactional SMTP call.

### Concurrency
`WORKER_CONCURRENCY` (default 5) jobs run in parallel per worker; you can also run several worker processes.
Everything shared is protected by Redis-side atomic scripts or Postgres row claims, never in-memory state.

### Minimum delay between sends
**Default: 2 seconds per sender** (`MIN_DELAY_BETWEEN_EMAILS_MS`). The limiter keeps a `gap` timestamp per sender in
Redis; each reservation is handed the next free slot (`max(now, gap)`) and advances the gap by the delay.
Short waits (≤5 s) are slept inside the worker, longer ones go back to BullMQ as delayed jobs carrying their
reserved slot, so a worker never sits blocked for minutes. The compose form's "delay between emails" additionally
spaces the campaign's `scheduled_at` values.

### Emails-per-hour rate limit
Per-sender, configurable (`MAX_EMAILS_PER_HOUR_PER_SENDER`, and the compose form's "Hourly limit", capped by it).
A Redis Lua script (atomic, uses Redis' own clock) keeps a counter per `sender × UTC hour window`.
* Under the limit: the counter is incremented and the send slot returned.
* Over the limit: **the job is not failed or dropped** — it is moved to a delayed state in the next hour window(s).
  A per-window overflow counter gives each deferred job a position `p`, so it lands in window
  `+⌊(p-1)/limit⌋` at offset `((p-1) mod limit) × gap` — preserving arrival order and spreading load instead
  of a thundering herd at the top of the hour.

Trade-offs: fixed (not sliding) windows allow a burst across a boundary; the counter is shared by all campaigns
of a sender, so the tightest limit in play wins.

### Behaviour under load (1000+ emails at the same time)
Scheduling is a single bulk insert plus bulk enqueue (chunks of 500). Workers pull at `WORKER_CONCURRENCY`;
the limiter admits at most `limit` per sender per hour at ≥ `gap` spacing and pushes the rest into later windows.
Tested with 1,200 emails at one timestamp and a limit of 40: exactly 40 were admitted, 1,160 deferred across later
hours, no failures, no drops. Adding senders (`SENDER_COUNT`) increases capacity linearly.

### Slack notification on limit hit
*Connect Slack* runs the real Slack OAuth v2 flow and stores the incoming-webhook URL per user.
The first time a sender's limit is hit in an hour window (Redis `SET NX` → once per window, across workers) the
worker POSTs to the owner's webhook. Not connected → silently skipped. Connecting later works immediately
(the webhook is read from the DB at hit time; no redeploy). Revoked webhooks (404/410) are dropped so the UI shows "not connected".

### Search (Elasticsearch)
Every email is indexed on creation and re-indexed on status change (`emails` index, fuzzy multi-match over
recipient / subject / body, filtered by user and tab). `GET /api/emails?view=…&q=…` uses it; on boot the whole table
is re-indexed in the background. If Elasticsearch is unreachable the API falls back to SQL `ILIKE`
(the response says which engine answered).

### Queue dashboard
Bull Board at **`/admin/queues`** (link in the dashboard header), protected by the app login.

## Features

**Backend** — scheduler (BullMQ delayed jobs, no cron) · persistence & reconciliation · idempotent sends ·
worker concurrency · min delay between sends · hourly per-sender limit with next-window rescheduling ·
multi-sender pool (Ethereal) · Slack OAuth + alerts · Elasticsearch indexing/search · Bull Board · Google OAuth sessions (httpOnly JWT cookie) · Zod validation.

**Frontend** — Google login · header with name, email, avatar, logout · Scheduled / Sent tabs with live polling ·
compose modal (subject, body, CSV/text upload with detected-address count, start time, delay, hourly limit) ·
search · pagination · loading, empty and error states · toasts · Slack connect card · reusable UI kit (`components/ui`).

## Assumptions, shortcuts, trade-offs
* The Figma file was not accessible while building, so the UI follows the described layout and the same features but is not pixel-matched to it.
* `Delay between emails` spaces the campaign; the enforced per-sender floor is the env value.
* Fixed hourly windows (UTC); see above.
* Schema is created with an idempotent `schema.sql` on boot instead of a migration framework.
* Ethereal captures mail rather than delivering it; the "preview" link is how you read it.
* Google/Slack secrets are not committed; `.env.example` lists what to set.
