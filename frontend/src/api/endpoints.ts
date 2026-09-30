import { api } from "./client";
import type { EmailPage, EmailView, ScheduleRequest, ScheduleResponse, SlackStatus, User } from "../types/api";

export const authApi = {
  me: () => api<User>("/auth/me"),
  logout: () => api<{ ok: true }>("/auth/logout", { method: "POST" }),
};

export const emailApi = {
  list: (view: EmailView, opts: { q?: string; page?: number; limit?: number } = {}) => {
    const p = new URLSearchParams({ view, page: String(opts.page ?? 1), limit: String(opts.limit ?? 20) });
    if (opts.q) p.set("q", opts.q);
    return api<EmailPage>(`/emails?${p}`);
  },
  schedule: (body: ScheduleRequest) =>
    api<ScheduleResponse>("/emails/schedule", { method: "POST", body: JSON.stringify(body) }),
};

export const slackApi = {
  status: () => api<SlackStatus>("/slack/status"),
  disconnect: () => api<{ ok: true }>("/slack/disconnect", { method: "POST" }),
  test: () => api<{ ok: boolean }>("/slack/test", { method: "POST" }),
};
