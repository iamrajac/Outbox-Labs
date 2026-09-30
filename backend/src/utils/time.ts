export const HOUR_MS = 3_600_000;

/** Start (epoch ms) of the UTC hour window that contains `ts`. */
export const hourWindowStart = (ts: number): number => Math.floor(ts / HOUR_MS) * HOUR_MS;
