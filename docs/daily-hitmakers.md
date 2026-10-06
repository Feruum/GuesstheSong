# Daily songs from 100 hitmakers

New UTC Daily challenges draw exclusively from the available tracks in `featured-hits` (100 hitmakers). The collection contained 500 verified previews at rollout; see the [song list](../data/featured-hitmakers.md).

The server fixes the pack, mixed difficulty and curated excerpt settings. A caller cannot select another pack or change these settings, including through `POST /api/v1/games`. `GET /api/v1/daily` uses the same authoritative service. Concurrent first visitors share the challenge selected by the PostgreSQL unique date constraint.

An already-published shared challenge stays unchanged through the end of its UTC date, and saved attempts keep their original song and progress. On 2026-10-06, production already had two Daily entries, including a completed result, so that day's challenge was retained. The first new hitmaker-only UTC day is **2026-10-07 at 00:00 UTC**. The UI explains the transition for saved challenges from the global mix and identifies the collection for new Daily games.

If there are no eligible hitmaker songs, Daily returns an actionable unavailable-collection error. It never creates a replacement from the global catalog. Existing source restrictions, guest ownership, answer secrecy, six listening stages, scoring, result persistence, daily rollover and streaks continue to apply.

## Verification on 2026-10-06

- Three new PostgreSQL/Redis integration tests verify exclusive selection, simultaneous first visitors, ignored caller settings, duplicate-answer scoring, saved result pack IDs, restoration after Redis loss, retention of an existing shared song, the next UTC day, and no global fallback when hitmaker previews are disabled.
- All three passed with both local services and the actual production Neon/Upstash services. Cloud checks used their own guests and isolated dates after 2400; cleanup has a separate 30-second timeout. They did not reset a real Daily challenge or modify another listener's attempts.
- The targeted API, source, engine and game-service suite passed **76 tests with zero failures**.
- Playwright passed the existing Daily resume, completion and result-sharing flow in the **desktop and mobile** projects against a fresh local production build.
- The Next.js production build and TypeScript check passed. ESLint passed for the project excluding the ignored `.data` directory, which contains private, temporary diagnostics.

```sh
bun test tests/daily-selection.test.ts tests/game-service.test.ts tests/game-engine.test.ts tests/api.test.ts tests/deezer.test.ts --env-file=.env.local
bun run build
bun node_modules/eslint/bin/eslint.js . --ignore-pattern '.data/**'
node --env-file=.env.local node_modules/@playwright/test/cli.js test e2e/game.spec.ts --grep 'Daily resumes attempts and offers shareable results'
```

The selection tests exercise future-date generation with a controlled server clock. They do not claim that a future UTC date has already occurred on the public website. Production playback and browser observations are checked separately after deployment, with the current shared challenge preserved.
