import type Redis from "ioredis";
import { getRedis, redisKey } from "./redis";

export interface Stored<T> { revision: number; value: T }
export class MissingStateError extends Error { constructor() { super("This game has expired. Start a new game."); } }
export class GuardChangedError extends Error { constructor() { super("A newer connection superseded this update."); } }
const compareAndSwap = `
local previous=redis.call('GET',KEYS[1]);
if previous~=ARGV[1] then return 0 end;
if KEYS[3] and (redis.call('GET',KEYS[3]) or '')~=ARGV[5] then return -1 end;
redis.call('SET',KEYS[1],ARGV[2],'EX',ARGV[3]);
redis.call('PUBLISH',KEYS[2],ARGV[4]);
return 1;
`;
export class AtomicStore {
  constructor(private readonly redis: Redis = getRedis(), private readonly prefix = redisKey("state")) {}
  key(id: string) { return `${this.prefix}:${id}`; }
  channel(id: string) { return `${this.prefix}:events:${id}`; }
  async load<T>(id: string): Promise<Stored<T> | null> {
    const raw = await this.redis.get(this.key(id));
    return raw ? JSON.parse(raw) as Stored<T> : null;
  }
  async create<T>(id: string, value: T, ttl = 86400, revision = 1): Promise<Stored<T>> {
    const stored = { revision, value };
    const inserted = await this.redis.set(this.key(id), JSON.stringify(stored), "EX", ttl, "NX");
    if (inserted) return stored;
    const existing = await this.load<T>(id);
    if (!existing) throw new MissingStateError();
    return existing;
  }
  async update<T>(id: string, reduce: (value: T) => T, ttl = 86400, guard?: { key: string; value: string }): Promise<Stored<T>> {
    for (let attempt = 0; attempt < 64; attempt++) {
      const previous = await this.redis.get(this.key(id));
      if (!previous) throw new MissingStateError();
      const current = JSON.parse(previous) as Stored<T>;
      const value = reduce(current.value);
      if (JSON.stringify(value) === JSON.stringify(current.value)) return current;
      const next = { revision: current.revision + 1, value };
      const arguments_ = guard ? [this.key(id), this.channel(id), guard.key, previous, JSON.stringify(next), ttl, String(next.revision), guard.value] : [this.key(id), this.channel(id), previous, JSON.stringify(next), ttl, String(next.revision)];
      const applied = await this.redis.eval(compareAndSwap, guard ? 3 : 2, ...arguments_);
      if (applied === -1) throw new GuardChangedError();
      if (applied === 1) return next;
    }
    throw new Error("The game is busy. Retry your action.");
  }
  async remove(id: string) { await this.redis.del(this.key(id)); }
}
let store: AtomicStore | undefined;
export function getStore() { return store ??= new AtomicStore(); }
