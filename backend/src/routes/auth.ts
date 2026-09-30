import { Router } from "express";
import crypto from "crypto";
import { env } from "../config/env";
import { pool } from "../db/pool";
import { requireAuth, SESSION_COOKIE, signSession } from "../middleware/auth";

export const authRouter = Router();

const redirectUri = () => `${env.publicUrl}/api/auth/google/callback`;
const STATE_COOKIE = "oauth_state";

authRouter.get("/google", (_req, res) => {
  if (!env.google.clientId) return res.status(500).send("GOOGLE_CLIENT_ID is not configured");
  const state = crypto.randomBytes(16).toString("hex");
  res.cookie(STATE_COOKIE, state, { httpOnly: true, sameSite: "lax", maxAge: 10 * 60_000 });
  const p = new URLSearchParams({
    client_id: env.google.clientId,
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: "openid email profile",
    state,
    prompt: "select_account",
  });
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${p}`);
});

authRouter.get("/google/callback", async (req, res) => {
  const { code, state } = req.query as Record<string, string | undefined>;
  if (!code || !state || state !== req.cookies?.[STATE_COOKIE]) {
    return res.redirect(`${env.frontendUrl}/login?error=state`);
  }
  res.clearCookie(STATE_COOKIE);
  try {
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: env.google.clientId,
        client_secret: env.google.clientSecret,
        redirect_uri: redirectUri(),
        grant_type: "authorization_code",
      }),
    });
    const tokens: any = await tokenRes.json();
    if (!tokens.access_token) throw new Error(tokens.error_description ?? "token exchange failed");

    const infoRes = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const info: any = await infoRes.json();
    if (!info.sub) throw new Error("userinfo failed");

    const { rows } = await pool.query(
      `INSERT INTO users (google_id, email, name, avatar_url) VALUES ($1,$2,$3,$4)
       ON CONFLICT (google_id) DO UPDATE SET email=EXCLUDED.email, name=EXCLUDED.name, avatar_url=EXCLUDED.avatar_url
       RETURNING id`,
      [info.sub, info.email, info.name ?? info.email, info.picture ?? null],
    );
    res.cookie(SESSION_COOKIE, signSession(rows[0].id), {
      httpOnly: true,
      sameSite: "lax",
      maxAge: 7 * 24 * 3600_000,
    });
    res.redirect(`${env.frontendUrl}/dashboard`);
  } catch {
    res.redirect(`${env.frontendUrl}/login?error=google`);
  }
});

authRouter.get("/me", requireAuth, async (req, res) => {
  const { rows } = await pool.query("SELECT id, email, name, avatar_url AS \"avatarUrl\" FROM users WHERE id=$1", [
    req.user!.id,
  ]);
  if (!rows[0]) return res.status(401).json({ error: "Unknown user" });
  res.json(rows[0]);
});

authRouter.post("/logout", (_req, res) => {
  res.clearCookie(SESSION_COOKIE);
  res.json({ ok: true });
});
