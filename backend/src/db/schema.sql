CREATE TABLE IF NOT EXISTS users (
  id          BIGSERIAL PRIMARY KEY,
  google_id   TEXT UNIQUE NOT NULL,
  email       TEXT NOT NULL,
  name        TEXT NOT NULL,
  avatar_url  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS senders (
  id          BIGSERIAL PRIMARY KEY,
  email       TEXT UNIQUE NOT NULL,
  smtp_host   TEXT NOT NULL,
  smtp_port   INT  NOT NULL,
  smtp_user   TEXT NOT NULL,
  smtp_pass   TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS slack_connections (
  user_id      BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  webhook_url  TEXT NOT NULL,
  team_name    TEXT,
  channel      TEXT,
  connected_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS emails (
  id             UUID PRIMARY KEY,
  user_id        BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sender_id      BIGINT NOT NULL REFERENCES senders(id),
  batch_id       UUID NOT NULL,
  to_email       TEXT NOT NULL,
  subject        TEXT NOT NULL,
  body           TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'scheduled'
                 CHECK (status IN ('scheduled','sending','sent','failed')),
  scheduled_at   TIMESTAMPTZ NOT NULL,
  sent_at        TIMESTAMPTZ,
  hourly_limit   INT NOT NULL,
  min_delay_ms   INT NOT NULL,
  attempts       INT NOT NULL DEFAULT 0,
  deferrals      INT NOT NULL DEFAULT 0,
  locked_at      TIMESTAMPTZ,
  error          TEXT,
  preview_url    TEXT,
  message_id     TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS emails_user_status_sched ON emails (user_id, status, scheduled_at);
CREATE INDEX IF NOT EXISTS emails_pending ON emails (status, scheduled_at) WHERE status IN ('scheduled','sending');
