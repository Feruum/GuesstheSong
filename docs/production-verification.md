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

Actual production WebSocket verification is pending deployment of the route. Local SDK tests do not establish Vercel runtime compatibility. Earlier Playwright reports cover local desktop/mobile behavior and are linked from the repository README.

## Reproduce local verification

Use development PostgreSQL/Redis and native socket servers on ports 3001 and 3002:

```powershell
bun run typecheck
bun run lint
$env:TEST_SOCKETS='1'
bun test tests --env-file=.env.local
$env:VERCEL='1'
bun run build
```

Do not run service tests against production: their fixtures create and remove their own test identities in the configured database. Production credentials and the admin password are stored only in ignored local files and Vercel environment settings.
