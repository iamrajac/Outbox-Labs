import { Router } from "express";
import crypto from "crypto";
import { env } from "../config/env";
import { requireAuth } from "../middleware/auth";
import {
  completeSlackOAuth,
  disconnectSlack,
  getSlackConnection,
  notifySlack,
  slackAuthUrl,
} from "../services/slack";

export const slackRouter = Router();
const STATE_COOKIE = "slack_state";

slackRouter.get("/connect", requireAuth, (req, res) => {
  if (!env.slack.clientId) return res.status(500).send("SLACK_CLIENT_ID is not configured");
  const state = crypto.randomBytes(16).toString("hex");
  res.cookie(STATE_COOKIE, state, { httpOnly: true, sameSite: "lax", maxAge: 10 * 60_000 });
  res.redirect(slackAuthUrl(state));
});

slackRouter.get("/callback", requireAuth, async (req, res) => {
  const { code, state } = req.query as Record<string, string | undefined>;
  if (!code || !state || state !== req.cookies?.[STATE_COOKIE]) {
    return res.redirect(`${env.frontendUrl}/dashboard?slack=error`);
  }
  res.clearCookie(STATE_COOKIE);
  try {
    await completeSlackOAuth(req.user!.id, code);
    res.redirect(`${env.frontendUrl}/dashboard?slack=connected`);
  } catch {
    res.redirect(`${env.frontendUrl}/dashboard?slack=error`);
  }
});

slackRouter.get("/status", requireAuth, async (req, res) => {
  const c = await getSlackConnection(req.user!.id);
  res.json({ connected: !!c, teamName: c?.team_name ?? null, channel: c?.channel ?? null });
});

slackRouter.post("/disconnect", requireAuth, async (req, res) => {
  await disconnectSlack(req.user!.id);
  res.json({ ok: true });
});

slackRouter.post("/test", requireAuth, async (req, res) => {
  const ok = await notifySlack(req.user!.id, ":white_check_mark: Outbox Scheduler is connected to this channel.");
  res.status(ok ? 200 : 409).json({ ok });
});
