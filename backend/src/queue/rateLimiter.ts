import { redis } from "./redis";
import { env } from "../config/env";

/**
 * Atomic "reserve a send slot" script. Runs entirely inside Redis, so any number of
 * workers / instances share one consistent view, and it uses Redis' own clock (TIME)
 * so instance clock skew cannot matter.
 *
 * Keys are derived inside the script from ARGV[3] (= "rl:{sender}") and the window
 * computed from Redis' clock, so a window boundary can never split the keys:
 *   {p}:count:{windowStart}     emails already reserved in this hour
 *   {p}:gap                     earliest ms timestamp the next send may go out
 *   {p}:over:{windowStart}      how many jobs overflowed this window (FIFO position)
 *   {p}:notified:{windowStart}  set once => Slack alert fires once per window
 * ARGV = limit, gapMs, keyPrefix
 *
 * Returns {status, timestampMs, firstHit}
 *   status 0: proceed, timestampMs = the slot this send is allowed to run at (>= now)
 *   status 1: over quota, timestampMs = when to retry (in a later hour window)
 */
const RESERVE_SLOT = `
local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
local hour = 3600000
local windowStart = now - (now % hour)
local windowEnd = windowStart + hour
local limit = tonumber(ARGV[1])
local gap = tonumber(ARGV[2])
local p = ARGV[3]
local kCount = p .. ':count:' .. windowStart
local kGap = p .. ':gap'
local kOver = p .. ':over:' .. windowStart
local kNotified = p .. ':notified:' .. windowStart

local count = tonumber(redis.call('GET', kCount) or '0')
local nextFree = tonumber(redis.call('GET', kGap) or '0')
local slot = math.max(now, nextFree)

if count >= limit or slot >= windowEnd then
  local pos = redis.call('INCR', kOver)
  redis.call('PEXPIRE', kOver, 3 * hour)
  -- Overflowed jobs are spread over the following windows in arrival order:
  -- position p lands in window (p-1)/limit ahead, at offset ((p-1)%limit)*gap.
  local ahead = math.floor((pos - 1) / limit)
  local offset = ((pos - 1) % limit) * gap
  if offset >= hour then offset = hour - 1 end
  local first = redis.call('SET', kNotified, '1', 'NX', 'PX', 3 * hour) and 1 or 0
  return {1, windowEnd + ahead * hour + offset, first, windowStart}
end

redis.call('INCR', kCount)
redis.call('PEXPIRE', kCount, 2 * hour)
redis.call('SET', kGap, slot + gap, 'PX', 2 * hour)
return {0, slot, 0, windowStart}
`;

redis.defineCommand("reserveSlot", { numberOfKeys: 0, lua: RESERVE_SLOT });

export type Reservation =
  | { ok: true; slot: number }
  | { ok: false; retryAt: number; firstHitInWindow: boolean; windowStart: number };

export async function reserveSlot(senderId: number, hourlyLimit: number): Promise<Reservation> {
  const res = (await (redis as any).reserveSlot(
    Math.min(hourlyLimit, env.maxEmailsPerHourPerSender),
    env.minDelayMs,
    `rl:${senderId}`,
  )) as [number, number, number, number];

  if (res[0] === 0) return { ok: true, slot: res[1] };
  return { ok: false, retryAt: res[1], firstHitInWindow: res[2] === 1, windowStart: res[3] };
}
