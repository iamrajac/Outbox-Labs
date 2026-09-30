// Needs a local Redis (REDIS_URL). Run: npm test
process.env.MIN_DELAY_BETWEEN_EMAILS_MS = "0";
process.env.MAX_EMAILS_PER_HOUR_PER_SENDER = "5";

import test, { after } from "node:test";
import assert from "node:assert/strict";

after(async () => {
  const { redis } = await import("../src/queue/redis");
  await redis.quit();
});

test("limiter admits exactly `limit` sends per hour across concurrent callers and defers the rest in order", async () => {
  const { reserveSlot } = await import("../src/queue/rateLimiter");
  const sender = 900000 + Math.floor(Math.random() * 90000);

  const results = await Promise.all(Array.from({ length: 23 }, () => reserveSlot(sender, 5)));
  const ok = results.filter((r) => r.ok);
  const deferred = results.filter((r): r is Extract<typeof r, { ok: false }> => !r.ok);

  assert.equal(ok.length, 5);
  assert.equal(deferred.length, 18);
  assert.equal(deferred.filter((d) => d.firstHitInWindow).length, 1, "Slack alert fires once per window");

  const hour = 3_600_000;
  const retry = deferred.map((d) => d.retryAt).sort((a, b) => a - b);
  assert.ok(retry[0] >= Math.floor(Date.now() / hour) * hour + hour - 1000, "deferred into a later window");
  // 18 overflow jobs at 5/hour -> spread over 4 following windows
  assert.equal(new Set(retry.map((t) => Math.floor(t / hour))).size, 4);

});

test("pacing gap hands out strictly increasing slots", async () => {
  process.env.MIN_DELAY_BETWEEN_EMAILS_MS = "0";
  const { env } = await import("../src/config/env");
  env.minDelayMs = 250;
  const { reserveSlot } = await import("../src/queue/rateLimiter");
  const sender = 800000 + Math.floor(Math.random() * 90000);
  const slots: number[] = [];
  for (let i = 0; i < 4; i++) {
    const r = await reserveSlot(sender, 100);
    assert.ok(r.ok);
    if (r.ok) slots.push(r.slot);
  }
  for (let i = 1; i < slots.length; i++) assert.ok(slots[i] - slots[i - 1] >= 250);
});
