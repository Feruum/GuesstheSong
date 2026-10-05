import Redis from "ioredis";
import { ConfigurationError } from "./db";

let client: Redis | undefined;
export function getRedis(): Redis {
  if (client) return client;
  if (!process.env.REDIS_URL) throw new ConfigurationError("The game service isn't connected yet.");
  client = new Redis(process.env.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 2, connectTimeout: 8000, retryStrategy: (times) => times > 3 ? null : Math.min(times * 300, 1000) });
  client.on("error", (error) => console.error("Redis connection error:", error.message));
  return client;
}
export function redisKey(value: string) { return `${process.env.REDIS_NAMESPACE || "gts"}:${value}`; }
export async function rateLimit(key: string, limit: number, seconds: number): Promise<boolean> {
  const count = await getRedis().eval("local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]); end; return n", 1, redisKey(`rate:${key}`), seconds) as number;
  return count <= limit;
}
