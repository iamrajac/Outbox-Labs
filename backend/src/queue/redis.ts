import IORedis from "ioredis";
import { env } from "../config/env";

/** BullMQ requires maxRetriesPerRequest = null on the connections it blocks on. */
export const createRedis = (): IORedis => new IORedis(env.redisUrl, { maxRetriesPerRequest: null });

/** Shared connection for the Queue producer and for our own rate-limit / lock commands. */
export const redis = createRedis();
