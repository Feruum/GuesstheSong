# Production verification — 2026-10-06

Public origin: https://guessthesong-rust.vercel.app

## Cloud configuration and first successful deployment

- Neon PostgreSQL and Upstash Redis: Free plans, region `iad1`, connected to Production only. Preview data is not shared.
- Actual PostgreSQL `SELECT 1` and Redis `PING` succeeded over the provider's TLS connections.
- Build preparation migrated the empty cloud database and seeded **1,500 public Audius recordings**. The build finished and Vercel marked the deployment Ready.
- `/api/v1/health`: HTTP 200, `status: ok`.
- `/api/v1/packs`: HTTP 200, global mix count 1,500. Verified metadata includes Pop, Hip-Hop/Rap, Rock, Alternative, Electronic, R&B/Soul, Jazz, Latin and Classical, and 2010s/2020s releases.
- Unauthenticated `/api/v1/admin/catalog`: HTTP 401, `ADMIN_REQUIRED`.
- Public familiar-artist Deezer previews remain disabled.

## Manual public Classic checks

Using a newly created browser guest and a real production game:

- Pack selector and guest profile loaded successfully.
- The one-second Audius clip played. Skipping unlocked the two-second clip, which also played.
- Search suggestions worked with keyboard selection and submission.
- A correct answer after one skip awarded **80 points** and revealed title, artist, source link and licensing text.
- Reloading the page restored the same revealed song and 80-point score.
- Browser error/warning logs were empty for this flow.

Daily also restored the skipped attempt and two-second stage after reloading. At a 375px viewport it showed all game controls and mobile navigation without horizontal overflow.

## WebSocket fix and regression coverage

The first configured deployment still returned HTTP 404 for `/api/ws`. The fix adds a Next.js route using the installed Vercel WebSocket SDK and keeps the localhost rewrite only for local development. Native Bun and hosted transports share authenticated room logic.

Before publication, **146 tests passed, zero failed**, with `TEST_SOCKETS=1`. These include 24 players across two native server instances, reconnect synchronization, simultaneous/deduplicated commands, and abrupt instance-crash detection after the 30-second grace period. New tests verify the Vercel SDK against real Node HTTP upgrades and local PostgreSQL/Redis, including origin/member rejection, replacement-connection presence, revocation after leaving, abandoned-lobby cleanup and delayed-disconnect grace handling. TypeScript, ESLint and the Vercel-mode production build passed.

The first route deployment exposed a Webpack interoperability issue: the bundled SDK's dynamic import of the CommonJS `ws` function omitted the named `WebSocketServer` export and returned HTTP 503 on upgrade. A regression test against the actual `.next` production route reproduced the exact runtime error. Keeping `@vercel/functions` external preserves its native dynamic import. The compiled-route test then passed, followed by successful public WSS verification on commit `22dfd35`. Local source-level SDK tests alone do not establish built or hosted compatibility. Earlier Playwright reports cover local desktop/mobile behavior and are linked from the repository README.

## Actual hosted game and connection checks

The production probe ran from 07:40:57 to 07:45:16 UTC using its own named QA guests and private rooms, with no catalog changes:

- **24 real WSS players** received the Party room, readied, started and played three rounds. All participants received a completed result table.
- Repeated command IDs did not apply readiness twice. A forced disconnect reconnected to the same round with the player online.
- All **24 connections rotated automatically** before their function limits, reconnected and received full completed state.
- Duel simultaneous correct answers awarded exactly one point. Leaving produced a forfeit, and a rematch returned to the lobby.
- Classic completed ten rounds with 80 points after a first-round skip; repeating the correct command did not duplicate points. Another guest was denied access to that game.
- Daily restored its skipped stage and game ID, completed with 80 points and returned the same completed challenge.
- Blitz awarded one point and precisely ten additional seconds, advanced on skip, kept sixteen-second clips, then completed at its server deadline.
- Chart Clash hid the challenger count, awarded a correct prediction and ended on the next incorrect prediction using its frozen state.
- PostgreSQL and the public stats API contained results for **all six modes**. The Classic result was stored once.
- Admin login with the configured password, protected catalog read and logout succeeded. Anonymous catalog access and unauthenticated cron requests were rejected.

Manual browser Party checks additionally covered a second player joining, ready state, starting, real audio, the thirty-second server timer, progressive skips, automatic next rounds, attribution and the final draw table. Browser warning/error logs were empty.

Manual QA found that a listener leaving a completed room disappeared from its final table. The subsequent fix preserves match participants in standings while checking current membership separately for HTTP/audio/upgrades. A Party unit test and a real PostgreSQL/Redis Duel test cover participant retention and HTTP rejection after leaving; the 59 relevant engine/service/adapter checks passed before publication.

## Reproduce local verification

Use development PostgreSQL/Redis and native socket servers on ports 3001 and 3002:

```powershell
bun run typecheck
bun run lint
$env:TEST_SOCKETS='1'
bun test tests --env-file=.env.local
$env:VERCEL='1'
bun run build
$env:TEST_BUILT_SOCKETS='1'
bun test tests/hosted-sockets.test.ts --env-file=.env.local
```

Do not run service tests against production: their fixtures create and remove their own test identities in the configured database. Production credentials and the admin password are stored only in ignored local files and Vercel environment settings.
