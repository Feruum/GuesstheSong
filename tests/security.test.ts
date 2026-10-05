import { describe, expect, test } from "bun:test";
import { makeAudioToken, verifyAudioToken, utcDate, stableDailyGameId, hashToken, validOrigin } from "../src/server/security";

describe("session-bound audio and daily identity", () => {
  test("audio tokens are bound to the guest, session, and expiry", () => {
    process.env.SESSION_SECRET ||= "test-secret-with-at-least-32-characters-for-unit-tests";
    const token = makeAudioToken({ guestId: "guest-a", scope: "solo", targetId: "game-a", trackIndex: 2 }, 1000);
    expect(verifyAudioToken(token, "guest-a", 2000)?.targetId).toBe("game-a");
    expect(verifyAudioToken(token, "guest-b", 2000)).toBeNull();
    expect(verifyAudioToken(token + "tampered", "guest-a", 2000)).toBeNull();
    expect(verifyAudioToken(token, "guest-a", 200000)).toBeNull();
  });
  test("daily identity is stable across servers and changes at UTC midnight", () => {
    expect(utcDate(Date.parse("2026-10-05T23:59:59Z"))).toBe("2026-10-05");
    expect(utcDate(Date.parse("2026-10-06T00:00:00Z"))).toBe("2026-10-06");
    expect(stableDailyGameId("2026-10-05", "guest-a")).toBe(stableDailyGameId("2026-10-05", "guest-a"));
    expect(stableDailyGameId("2026-10-05", "guest-a")).not.toBe(stableDailyGameId("2026-10-06", "guest-a"));
  });
  test("mutation origins must match the actual application", () => {
    expect(validOrigin("http://127.0.0.1:3000", "http://127.0.0.1:3000/api/v1/games")).toBe(true);
    expect(validOrigin("https://attacker.example", "http://127.0.0.1:3000/api/v1/games")).toBe(false);
    expect(validOrigin(null, "http://127.0.0.1:3000/api/v1/games")).toBe(false);
    expect(hashToken("a-private-token")).not.toContain("a-private-token");
  });
});
