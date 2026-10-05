# Familiar songs and genres: local verification

Verified on 2026-10-05 at http://127.0.0.1:3000. No public deployment was made.

## Actual catalog

PostgreSQL contains **5,001 records**, of which **5,000 are available**: 1,500 Audius tracks and **3,500 official Deezer previews from familiar artists**. The previously disabled Audius recording remains disabled. `/api/v1/health` returned `{"status":"ok"}` against the persistent local PostgreSQL bridge and actual Redis.

The new repeatable importer uses canonical artist identities, provider metadata, edition deduplication and availability checks. It excludes tribute/karaoke and altered-speed recordings. These are songs by established artists; the whole collection is not claimed to be a chart of 3,500 radio hits. Imported examples include Blinding Lights, Lose Yourself, Bohemian Rhapsody, Smells Like Teen Spirit, Bad Romance and Love Story. Each of those six produced a bounded sixteen-second MP3 during provider checks.

There are 22 overlapping automatic collections. The live API returned:

| Genre | Available songs |
| --- | ---: |
| Pop | 1,031 |
| Hip-hop | 893 |
| Rock | 792 |
| Electronic | 707 |
| Indie & alternative | 671 |
| R&B & soul | 229 |
| Jazz | 164 |
| Latin | 135 |
| Country | 84 |
| Metal | 80 |
| Classical | 68 |
| Reggae | 57 |
| House | 51 |

The decade packs contain 27 songs from the 1980s, 158 from the 1990s, 692 from the 2000s, 1,402 from the 2010s and 2,664 from the 2020s. The familiar-artist 2010s collection has 1,341 songs. Dates come from provider release metadata; a reissued edition can have a later release year than the original recording. Unknown language metadata remains unset.

The primary Start guessing action selects the 3,500-song familiar-artist pack. Pop, Hip-hop and other genre names are explicit headings. A single-genre filtered discovery page starts the selected genre pack. Classic samples the full catalog, including songs beyond the previous 2,000-row cap. Chart Clash and Popular on Audius continue to use actual Audius counts; Deezer ranking is stored separately and never presented as a play count.

## Final checks

| Check | Result |
| --- | --- |
| Next.js production build with Bun/Webpack, including TypeScript | Passed |
| ESLint | Passed |
| Core/provider/security/catalog/PostgreSQL/Redis/service tests | 129 passed; 3 optional socket checks skipped |
| Full desktop/mobile Playwright suite before final review fixes | 48 passed |
| Final desktop/mobile hits and catalog regression run | 12 passed |
| Final desktop/mobile Daily persistence and UTC rollover run | 4 passed |
| Real Blinding Lights native browser playback | 1- and 2-second stages decoded; correct guess scored 80; artist, artwork and Deezer attribution appeared |
| Ordinary random familiar-artist game, direct browser inspection | Dance, Dance by Fall Out Boy; all six unlock stages, real playback and reveal worked |
| Mobile Pop page and desktop genre collections | Correct headings; no horizontal overflow at checked widths; no page errors observed |

The ordinary random game used UI controls rather than a chosen-answer fixture. Its one-second, two-second and sixteen-second audio decoded at 0.992625, 1.98525 and 15.986938 seconds respectively, without media errors. The answer remained hidden until reveal. Direct inspection also confirmed all 13 genre headings and the 1980s–2020s collections. Browser automation used Chromium at 1440 × 900 and 375 × 812; these are viewport checks, not physical-device or Safari tests.

Independent code review found two defects. Provider error code 800 previously stopped a refresh instead of classifying a permanently missing recording; missing records now become unavailable, while temporary outages remain retryable. Saved Daily games could still try to serve private previews after that source was disabled; eligibility is now checked before cached progress is advanced or SQL progress is restored, preserving the saved game and reporting the unavailable source. Both failures were reproduced with regression tests before the fixes; the final core suite passed afterward. The reviewer found no remaining important issue in the follow-up review.

To repeat the focused browser checks with the local services and app running:

```powershell
bun run test:e2e e2e/hits.spec.ts e2e/catalog.spec.ts
bun run test:e2e e2e/game.spec.ts e2e/recovery.spec.ts --grep Daily
```

## Playback source and limits

Deezer previews require `DEEZER_PRIVATE_PREVIEWS=true` and a loopback `APP_URL`. They are enabled for private, noncommercial local listening under the [developer terms](https://developers.deezer.com/termsofuse). Each provider excerpt is up to thirty seconds and can begin partway through the original song; only the unlocked 1/2/4/7/11/16 seconds are served by session-bound opaque endpoints. Preview URLs remain server-side, metadata tags are removed, and artwork/source attribution appears on reveal. Full recordings are not imported.

Public configuration hides these previews from search, pack counts and new game pools, rejects their audio before checking cached clips, and prevents active saved games from advancing. A public launch needs an independently authorized music source and remains outside this local delivery. No iTunes/Spotify trivia integration or extracted YouTube audio was added.

These checks sampled real provider playback; they do not establish that every one of the 5,000 songs plays in every region or browser. Availability can change after import. Rapid browser navigation that aborts an in-flight Next.js response can still produce a Bun server log about an early-closed destination stream; the checked browser flows and health request succeeded. Cloud infrastructure and physical mobile browsers remain unverified.

The earlier 24-player cross-instance/crash checks are recorded in [runtime verification](runtime-verification.md) and were not rerun for this catalog change. The Frontend Workbench canonical 62-state adapter remains blocked at its empty-URL Windows startup; formal delivery acceptance is not claimed.

## Rendered evidence

- [Desktop genre discovery](runtime-genres-desktop.png)
- [Mobile genre discovery](runtime-genres-mobile.png)
- [Desktop original-hit reveal](runtime-hit-reveal-desktop.png)
- [Mobile original-hit reveal](runtime-hit-reveal-mobile.png)
