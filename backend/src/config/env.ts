import "dotenv/config";

const num = (key: string, fallback: number): number => {
  const raw = process.env[key];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`Env ${key} must be a number, got "${raw}"`);
  return n;
};

const str = (key: string, fallback = ""): string => process.env[key] ?? fallback;

export const env = {
  port: num("PORT", 4000),
  frontendUrl: str("FRONTEND_URL", "http://localhost:5173"),
  /** Public base URL the browser uses (the Vite dev proxy makes it the frontend origin). */
  publicUrl: str("PUBLIC_URL", "http://localhost:5173"),
  jwtSecret: str("JWT_SECRET", "dev-only-change-me"),

  databaseUrl: str("DATABASE_URL", "postgres://outbox:outbox@localhost:5432/outbox"),
  redisUrl: str("REDIS_URL", "redis://localhost:6379"),
  elasticUrl: str("ELASTICSEARCH_URL", "http://localhost:9200"),

  google: {
    clientId: str("GOOGLE_CLIENT_ID"),
    clientSecret: str("GOOGLE_CLIENT_SECRET"),
  },
  slack: {
    clientId: str("SLACK_CLIENT_ID"),
    clientSecret: str("SLACK_CLIENT_SECRET"),
  },

  /** "ethereal" = real Ethereal SMTP; "local" = in-process stream transport (offline tests only). */
  mailTransport: str("MAIL_TRANSPORT", "ethereal") as "ethereal" | "local",
  senderCount: num("SENDER_COUNT", 3),

  queueName: str("QUEUE_NAME", "email-send"),
  workerConcurrency: num("WORKER_CONCURRENCY", 5),
  /** Minimum gap between two sends from the same sender (ms). */
  minDelayMs: num("MIN_DELAY_BETWEEN_EMAILS_MS", 2000),
  /** Default and upper bound of the per-sender hourly quota. */
  maxEmailsPerHourPerSender: num("MAX_EMAILS_PER_HOUR_PER_SENDER", 200),
  maxSendAttempts: num("MAX_SEND_ATTEMPTS", 3),
  /** A job claimed as "sending" longer than this is considered abandoned by a crashed worker. */
  sendingLockMs: num("SENDING_LOCK_MS", 120_000),
};

export const isProd = process.env.NODE_ENV === "production";
