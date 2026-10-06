import { describe, expect, test } from "bun:test";
import config from "../next.config";

describe("multiplayer routing", () => {
  test("Vercel serves the hosted socket route instead of proxying to a missing local server", async () => {
    const previous = process.env.VERCEL;
    process.env.VERCEL = "1";
    try {
      const rules = await config.rewrites!();
      const before = Array.isArray(rules) ? rules : rules.beforeFiles;
      expect(before?.find(rule => rule.source === "/api/ws")).toBeUndefined();
    } finally { if (previous === undefined) delete process.env.VERCEL; else process.env.VERCEL = previous; }
  });
  test("local development keeps the separate Bun socket server", async () => {
    const previous = process.env.VERCEL;
    delete process.env.VERCEL;
    try {
      const rules = await config.rewrites!();
      const before = Array.isArray(rules) ? rules : rules.beforeFiles;
      expect(before?.find(rule => rule.source === "/api/ws")?.destination).toBe(`http://127.0.0.1:${process.env.SOCKET_PORT || 3001}/api/ws`);
    } finally { if (previous === undefined) delete process.env.VERCEL; else process.env.VERCEL = previous; }
  });
});
