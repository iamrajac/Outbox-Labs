import { pool } from "../db/pool";
import { env } from "../config/env";
import { logger } from "../utils/logger";

const SLACK_AUTH = "https://slack.com/oauth/v2/authorize";
const SLACK_TOKEN = "https://slack.com/api/oauth.v2.access";

export const slackRedirectUri = () => `${env.publicUrl}/api/slack/callback`;

export function slackAuthUrl(state: string): string {
  const p = new URLSearchParams({
    client_id: env.slack.clientId,
    scope: "incoming-webhook",
    redirect_uri: slackRedirectUri(),
    state,
  });
  return `${SLACK_AUTH}?${p}`;
}

/** Exchange the OAuth code and persist the incoming webhook chosen by the user. */
export async function completeSlackOAuth(userId: number, code: string): Promise<void> {
  const res = await fetch(SLACK_TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.slack.clientId,
      client_secret: env.slack.clientSecret,
      code,
      redirect_uri: slackRedirectUri(),
    }),
  });
  const data: any = await res.json();
  if (!data.ok || !data.incoming_webhook?.url) throw new Error(`Slack OAuth failed: ${data.error ?? "no webhook"}`);
  await pool.query(
    `INSERT INTO slack_connections (user_id, webhook_url, team_name, channel)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (user_id) DO UPDATE SET webhook_url=EXCLUDED.webhook_url, team_name=EXCLUDED.team_name,
       channel=EXCLUDED.channel, connected_at=now()`,
    [userId, data.incoming_webhook.url, data.team?.name ?? null, data.incoming_webhook.channel ?? null],
  );
}

export async function getSlackConnection(userId: number) {
  const { rows } = await pool.query(
    "SELECT team_name, channel, connected_at FROM slack_connections WHERE user_id=$1",
    [userId],
  );
  return rows[0] ?? null;
}

export async function disconnectSlack(userId: number): Promise<void> {
  await pool.query("DELETE FROM slack_connections WHERE user_id=$1", [userId]);
}

/** Post to the user's Slack webhook. Returns false (never throws) if not connected or Slack rejects. */
export async function notifySlack(userId: number, text: string): Promise<boolean> {
  try {
    const { rows } = await pool.query("SELECT webhook_url FROM slack_connections WHERE user_id=$1", [userId]);
    if (!rows[0]) return false; // not connected: rate-limit hits simply don't notify
    const res = await fetch(rows[0].webhook_url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (res.status === 404 || res.status === 410) {
      // Webhook revoked in Slack: drop it so the UI shows "not connected" and reconnect works cleanly.
      await disconnectSlack(userId);
      return false;
    }
    if (!res.ok) logger.warn({ status: res.status }, "slack webhook rejected message");
    return res.ok;
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "slack notify failed");
    return false;
  }
}
