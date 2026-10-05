# Local implementation verification

## Latest familiar-song expansion, 2026-10-05

The local catalog now contains **5,000 available songs**: 1,500 Audius tracks and 3,500 official Deezer previews. The latest production build and ESLint passed; the build's TypeScript checks passed. The final core suite passed **129 tests**, with the three optional live socket tests skipped. The expanded full desktop/mobile suite passed **48 tests** before the final provider/Daily review fixes; all **16 relevant catalog, hits and Daily browser checks** passed again against the final rebuilt server. The live socket checks below were performed during the earlier pass and were not repeated for this catalog expansion.

Actual familiar-song playback, current genre counts, source restrictions and screenshots are recorded in the [familiar-song verification report](hits-verification.md). The original verification pass below is retained as historical evidence; its 1,500-song counts and 42-test browser suite predate this expansion. The Frontend Workbench canonical adapter limitation remains unchanged.

## Earlier local verification pass

Verified on 2026-10-05 against the running production build at http://127.0.0.1:3000. Vercel deployment and its experimental WebSocket adapter are outside the current request.

| Check | Result |
| --- | --- |
| Frozen Bun dependency installation | Passed; 724 installed dependencies checked without changes |
| TypeScript | Passed |
| ESLint | Passed with no warnings |
| Next.js production build with Bun/Webpack | Passed |
| Engine, provider, security, catalog, Hono, PostgreSQL, Redis, result ranking and local protocol tests | 117 passed |
| Live multiplayer: 24 players across two instances, authenticated access, abrupt server crash | 3 passed |
| Playwright desktop + 375px mobile | 42 passed |
| Concurrent live HTTP guest/catalog requests | 24 requests across 8 guests; all returned 200 |
| Daily clipboard result, including real line breaks | Passed on desktop and mobile |
| Browser console on discovery | No console errors or page errors observed |
| Accessibility on discovery and the listening screen | No critical or serious axe violations |

The default core command passed 117 tests and intentionally skipped the three live socket checks. Those three were then enabled and passed separately, for 120 distinct logic/server/integration tests in total. TypeScript, ESLint and the production build also passed after the final fixes.

The import contains 1,500 eligible, available Audius tracks. Live pack counts are 1,500 global, 361 electronic, 290 hip-hop, 287 indie/alternative, 298 pop, 194 rock, 61 from the 2010s, 1,439 from the 2020s and 200 most-played songs. Packs overlap. One song that repeatedly failed streaming was disabled and replaced with a validated song of the same genre and decade; PostgreSQL retains 1,501 records. Real browser checks played one-second MP3 clips, a curated excerpt starting at 20 seconds, and a Blitz excerpt decoded at 15.984 seconds. The importer used the real provider; this does not claim that every track was decoded on every browser.

The SQL service is persistent PGlite exposed through PostgreSQL wire protocol on port 15432; Redis is an actual Ubuntu WSL Redis server on port 16379. Neon and Upstash cloud accounts have not been configured. These tests establish local behavior, not cloud deployment behavior.

A rare local bridge failure was reproduced in a separate in-memory database: clients could overwrite the single backend's unnamed prepared statement between Parse and Bind. The replacement development queue keeps a complete query cycle and explicit transaction on one client, recovers after errors/disconnects and rolls back an interrupted transaction. Eight isolated wire-protocol regressions pass; the original implementation failed four of those checks. The persistent catalog and guest data were preserved during the bridge restart.

Playwright exercised all six modes, server result persistence, keyboard song selection, audio-stage unlocking, playback during stage changes, retry after an intentional audio outage, saved Daily attempts, leaderboard/profile pages, protected catalog editing/import, private room invitations, sockets and reconnects. Additional regressions verify filter reset, genre/decade pack selection, missing artwork, cached guest hydration, sixteen-second Blitz clips and a real thirty-second host disconnect that puts the Duel winner first. Recovery tests covered cached room expiration, an in-flight matchmaking cancellation and a new Daily game with a lower revision at UTC midnight. Browser rollover uses an explicit controlled server-date fixture; backend UTC identity and persistence have separate tests.

Direct browser inspection also covered the six modes, private multiplayer with separate guests, mobile and tablet layouts, real genre-pack audio, admin metadata synchronization and provider reimport. See the [manual verification report](manual-verification.md) for actions, fixes, actual music totals and limits. The five 2010s difficulty bands each started a ten-round Classic successfully through the production API.

The visual direction was checked against the accepted concepts: warm charcoal/cream/lime, record artwork, strong discovery hierarchy and a focused mobile listener. Screenshots below show actual rendered pages with PostgreSQL-backed data.

- [Desktop discovery](runtime-discover-desktop.png)
- [Mobile discovery](runtime-discover-mobile.png)
- [Desktop listening screen](runtime-classic-desktop.png)
- [Mobile listening screen](runtime-classic-mobile.png)
- [Desktop Party](runtime-party-desktop.png)
- [Mobile Party](runtime-party-mobile.png)
- [Desktop Duel](runtime-duel-desktop.png)
- [Mobile Duel](runtime-duel-mobile.png)
- [Desktop Duel disconnect result](runtime-duel-forfeit-desktop.png)
- [Mobile Duel disconnect result](runtime-duel-forfeit-mobile.png)

The independent Frontend Workbench canonical adapter did not return from its initial empty-URL browser launch on Windows. The installed launcher and unchanged native binary were both tried, and their verifier attempts were cancelled. That limitation is recorded as BLOCKED in the ignored workbench session. No canonical 62-state fidelity completion or delivery acceptance is claimed. Rendered product verification above comes from the project's passing Playwright suite and direct browser inspection.

Desktop and mobile browser automation used Chromium. Safari/Firefox and a public deployment remain unverified. Current host defaults intentionally bind to localhost.
