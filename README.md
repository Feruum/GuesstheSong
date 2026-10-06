# guess the song

A complete local music guessing game: Next.js App Router, React, Tailwind CSS, Radix/shadcn-style controls, and a Bun/Hono backend. PostgreSQL stores the catalog and saved results; Redis owns live games, room revisions, matchmaking, presence and rate limits.

**Play the public game at [guessthesong-rust.vercel.app](https://guessthesong-rust.vercel.app).** Production uses Neon PostgreSQL and Upstash Redis on their free plans, with 1,500 public Audius recordings. On 2026-10-06 all six modes saved production results, and 24 hosted WebSocket players completed Party, reconnected and rotated their connections. Classic, Daily and Party were also checked through the browser, including real audio, keyboard guesses and saved progress. Start the local game at **http://127.0.0.1:3000** using the instructions below.

Follow the [deployment instructions](docs/vercel-deployment.md). A configured Vercel deployment automatically creates the schema and seeds a new database with 1,500 public Audius tracks. Party/Duel use the Vercel WebSocket adapter in production and the native Bun bridge locally, sharing the same Redis-backed room logic. Local data is preserved separately. Private-local Deezer previews are automatically disabled for public hosting. See the [production verification record](docs/production-verification.md) for the checks actually completed.

## Included

- Classic: ten songs; six guesses; clips of 1, 2, 4, 7, 11 and 16 seconds; 100/80/60/40/20/10 points. Mixed or five popularity bands, pack selection and curated/song-start excerpts.
- Daily: one shared song per UTC date; persistent, resumable attempts; streaks and copied results.
- Party: private invite codes, 2–24 players, readiness, host settings, 3–30 rounds, 30-second rounds and speed scoring.
- Blitz: 45 seconds; 16-second listening clips; one point and ten additional seconds for a correct answer.
- Duel: invitations or random matchmaking; seven 30-second rounds; first correct answer wins a point, plus draws, forfeits and rematches.
- Chart Clash: higher/lower predictions against play counts frozen when the game starts; equal counts are excluded.
- Classic/Daily/Blitz/Chart leaderboards, guest profiles, multiplayer result tables and a protected catalog dashboard.

The local catalog contains **5,000 available songs: 1,500 Audius tracks and 3,500 official Deezer previews from familiar artists**. The primary Start guessing button opens the familiar-artist collection. Examples include The Weeknd’s Blinding Lights, Eminem’s Lose Yourself, Queen’s Bohemian Rhapsody, Nirvana’s Smells Like Teen Spirit, Lady Gaga’s Bad Romance and Taylor Swift’s Love Story. Genres have explicit headings and their own playable packs.

Packs overlap. Counts come from PostgreSQL and may change as tracks are disabled or imported. Popular on Audius and Chart Clash use only Audius play counts; Deezer popularity rankings are kept separately and never represented as play counts. Decades use provider release metadata, including the release date of reissued editions.

| Collection | Playable songs |
| --- | ---: |
| Global mix | 5,000 |
| Hits & familiar artists | 3,500 |
| 2010s · Familiar artists | 1,341 |
| Hip-hop / rap | 893 |
| Pop | 1,031 |
| Rock | 792 |
| Alternative / indie | 671 |
| Electronic | 707 |
| R&B / soul | 229 |
| Jazz | 164 |
| Latin | 135 |
| Country | 84 |
| Metal | 80 |
| Classical | 68 |
| Reggae | 57 |
| House | 51 |
| 1980s | 27 |
| 1990s | 158 |
| 2000s | 692 |
| 2010s | 1,402 |
| 2020s | 2,664 |
| Popular on Audius | 200 |

Counts verified on 2026-10-05. Every displayed genre and decade pack has at least ten songs for Classic. Collections with fewer than fifty songs use mixed difficulty; the five bands each need at least ten songs.

One Audius track that repeatedly failed real playback checks was disabled and replaced with a validated song of the same genre and decade. The database preserves that disabled record; it has 5,001 stored records and 5,000 available songs. See the [familiar-song expansion checks](design/hits-verification.md), [earlier manual checks and fixes](design/manual-verification.md) and [verification results](design/runtime-verification.md).

The design follows the accepted [screen concepts](design/2026-10-04/README.md): warm charcoal, cream, lime, original record artwork and self-hosted Space Grotesk/DM Sans. Browser screenshots live in `design/runtime-*.png`.

## Start on this Windows computer

Install Bun 1.4.2 or newer. Node 20.19+ is needed only for the Playwright browser-test runner. The existing local environment uses persistent PGlite PostgreSQL on **15432** and Ubuntu WSL Redis on **16379**. PGlite is a development database, not a production service.

```powershell
bun install --frozen-lockfile
bun run local:setup
```

`local:setup` preserves an existing `.env.local`. On a new checkout it generates local secrets, an Argon2 admin hash and an ignored `.data/admin-password.txt`; it does not print credentials. Read that file locally to sign in at `/admin`.

If Redis is not installed in Ubuntu WSL yet, run once:

```powershell
wsl -d Ubuntu --exec sudo apt-get update
wsl -d Ubuntu --exec sudo apt-get install -y redis-server
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/local-redis.ps1
```

In a separate terminal, keep the development database running:

```powershell
bun run local:database
```

The development PostgreSQL bridge keeps each client's complete query cycle and transaction together. Its regression suite covers parallel parameterized queries, protocol errors, disconnects and rollback. It is designed for this app's unnamed queries; use regular PostgreSQL for independent session state or production workloads.

Then initialize and start the app:

```powershell
bun run db:migrate
bun run catalog:import
bun run dev
```

`dev` starts Next.js on **3000** and the Bun WebSocket bridge on **3001**. Open **http://127.0.0.1:3000** consistently so the browser keeps the same guest cookie. The migration and catalog import are repeatable; imports preserve admin metadata corrections and disabled tracks.

The Audius importer targets 1,500 playable Audius tracks, first filling genre collections and finding releases from 2010–2019, then growing the global mix. Disabled songs remain in the library and are excluded from the target count, so rerunning the importer can fill their places without re-enabling them. It reports actual playable totals and bounded provider retries. To reorganize existing songs without contacting Audius:

```powershell
bun run catalog:organize
```

Default collections update automatically after imports, genre/release-year/availability edits and provider refreshes. Their names, descriptions and artwork remain editable. Create a custom pack to add or remove handpicked songs; imports may target the global mix or a custom pack.

## Familiar songs for private local play

The current computer has `DEEZER_PRIVATE_PREVIEWS=true`. To reproduce the familiar-artist collection on a fresh local checkout, add that setting to `.env.local`, keep `APP_URL=http://127.0.0.1:3000`, migrate and import:

```powershell
bun run db:migrate
bun run catalog:hits 3500
```

This is opt-in for strictly private, noncommercial listening. Review the [official Deezer developer terms](https://developers.deezer.com/termsofuse). A public `APP_URL` automatically hides these previews from catalog/search/game pools and rejects their audio, including previously cached clips. The public deployment uses Audius; public familiar-hit gameplay needs an independently authorized source.

The repeatable importer resolves an explicit editorial list of established artists to their canonical provider IDs, includes associated original recordings/official collaborations, filters karaokes/tributes/live demos, removes repeated editions, spaces requests and retries quota responses. Metadata is cached for one day under ignored `.data/deezer-metadata`; signed preview URLs remain server-side and are resolved fresh during playback. The result is in `.data/hits-import-report.json`. A target is an upper bound; the command reports the actual total and skipped artists.

Deezer supplies a thirty-second excerpt, which may begin in the middle of the original song. The game serves only the unlocked 1/2/4/7/11/16 seconds, strips MP3 answer tags and displays the original artist and Deezer link on reveal. Its saved duration/excerpt offsets refer to the preview; Audius retains original-song excerpt support. Missing provider recordings are disabled during availability refresh. Disabling private previews gives saved games an explicit unavailable state and preserves their progress.

## Docker alternative

Use the included PostgreSQL 17 / Redis 7 services when Docker is available:

```powershell
docker compose up -d
bun run local:setup
```

Set these two lines in `.env.local` to match Docker, then run migration, import and `dev` as above:

```dotenv
DATABASE_URL=postgresql://music:music@127.0.0.1:5432/music
REDIS_URL=redis://127.0.0.1:6379
```

Do not run the PGlite database or WSL Redis when using Docker's corresponding services. Stored development data lives in `.data/` for PGlite/WSL, or named Docker volumes for Compose.

## Production mode locally

Stop `dev` first; keep PostgreSQL and Redis running.

```powershell
bun run build
bun run start
```

Next.js runs with Bun and Webpack. The local Next server forwards `/api/ws` to the Bun bridge. Room state is shared in Redis; each instance subscribes to versioned events, resynchronizes reconnects, enforces server deadlines and keeps a 30-second disconnect grace period. Connections rotate every four minutes. A crashed process is detected through expiring Redis presence.

## Configuration

`.env.example` documents the environment. Required settings are `DATABASE_URL`, `REDIS_URL`, `APP_URL`, `SESSION_SECRET` and an admin hash. Use `ADMIN_PASSWORD_HASH_BASE64` for Argon2 hashes in dotenv files to preserve dollar signs. `bun run admin:password` provides a hash generator. `AUDIUS_API_KEY` is optional for the initial public provider; authenticated credentials must remain server-side.

Use independent database/Redis namespaces and secrets for separate environments. Keep `.env.local`, `.data/`, browser traces and admin passwords out of Git. Cookies are HttpOnly, SameSite=Lax and Secure on HTTPS. Admin sessions expire after twelve hours; logins are throttled and mutations validate the request origin.

The catalog admin supports live Audius search, eligible-track and playlist imports, pack creation/editing, custom-pack assignment/removal, excerpt positions, metadata corrections, disabling tracks and paged availability checks. Unknown language data remains unset; only provider-verified or admin-curated genres, release decades and languages appear as filters. Release decade refers to provider release metadata.

## Tests

Keep the local database and Redis running. Unit tests and service tests use real local persistence and clean up their own test identities. Run them against development data, not a production database.

```powershell
bun run typecheck
bun run lint
bun run test
```

Install the browser once and run desktop/mobile flows against the running app:

```powershell
bunx playwright install chromium
bun run test:e2e
```

For the 24-player, cross-instance and crash-recovery tests, keep the normal bridge on 3001 and start another instance in a separate terminal:

```powershell
$env:SOCKET_PORT='3002'
bun run --env-file=.env.local src/server/socket-server.ts
```

Then run:

```powershell
$env:TEST_SOCKETS='1'
bun test tests/sockets.test.ts --env-file=.env.local
```

The crash test spawns its own third server on an OS-assigned port and terminates only that child. Playwright covers scoring/results, real audio and a nonzero excerpt, failure/retry, saved Daily progress, guest editing, administration, room access and reconnects on desktop and 375px mobile. Controlled state fixtures accelerate clocks and choose known answers; Audius playback/import and Deezer preview playback checks use the real providers. On 2026-10-06 all 146 service/unit/socket tests passed with `TEST_SOCKETS=1`, including 24 players, cross-instance reconnects and crash recovery. The new hosted-adapter tests exercise real HTTP upgrades through the installed Vercel SDK with local PostgreSQL/Redis; actual hosting is checked separately. The earlier full browser suite passed 48 tests; after the provider/Daily fixes, all 16 relevant desktop/mobile catalog, hits and Daily checks passed again. See the dated reports for coverage and limitations.

## Source and API

- `src/app`: server-rendered discovery and pack pages, metadata, frontend routes and the Hono adapter.
- `src/components`, `src/hooks`: interactive gameplay, audio, room sockets, forms and accessible controls.
- `src/shared/contracts.ts`: shared Zod request contracts and public metadata types.
- `src/server/game-engine.ts`: deterministic rules, score/deadline calculations and privacy projections.
- `src/server/game-service.ts`: authorization, atomic transitions, Daily persistence, matchmaking and statistics.
- `src/app/api/ws/route.ts`: Vercel Next.js WebSocket route, authenticated before upgrading and bounded by function deadlines.
- `src/server/socket-server.ts`, `room-sockets.ts`, `presence.ts`: native Bun transport, shared authenticated room events, presence and disconnect recovery.
- `src/server/audio-clips.ts`: server-bounded MPEG clips and byte-range handling; no full source track is sent to players.
- `migrations/0001_initial.sql`, `migrations/0002_popularity_score.sql`, `src/server/schema.ts`: SQL migrations and Drizzle schema.
- `src/server/deezer.ts`, `scripts/import-hits.ts`: private-local official previews and repeatable familiar-artist imports.
- `scripts/local-pgwire-queue.ts`: local development PostgreSQL bridge with query-cycle and transaction ownership.

Hono is mounted at `/api/v1`. Routes include `/guest`, `/packs`, `/catalog/search`, `/games`, `/games/:id/commands`, `/daily`, `/rooms`, `/rooms/:code/commands`, `/matchmaking`, `/stats`, `/leaderboards`, `/audio/:token` and protected `/admin/*`. See `src/server/api.ts` for validation and error contracts. Guesses use catalog IDs; the API derives player identity from the browser cookie and never accepts scores or deadlines from clients. Command UUIDs deduplicate retries.

## Music and attribution

Audius provides a [free streaming API](https://docs.audius.co/). Imports exclude gated, private, deleted, unavailable, unstreamable and unsupported-license tracks. The app displays artist, song source and applicable licensing information when revealing songs. It follows the provider's [licensing update](https://blog.audius.co/posts/audius-terms-of-service-update) and [Open Music License](https://audius.org/open-music-license.pdf). Imported rights metadata is retained, and administrative disabling takes effect on audio requests.

Provider outages produce a retry state without consuming a guess. Short MP3 clips contain only complete frames within the unlocked stage and strip answer-bearing metadata; byte ranges are restricted to that clip. Track availability can change after import. Audius artists own their music; no music files are committed to this repository.

Font licenses are included in `public/fonts/*-OFL.txt`. Original AI-generated pack artwork and design references are included with the source.
