# Manual browser and music checks

This report records the earlier Audius-only pass. The subsequent [familiar-song expansion checks](hits-verification.md) cover the current **5,000-song** catalog, including 3,500 official previews, explicit genre headings and the latest manual playback. Earlier counts below are historical.

Checked on 2026-10-05 against the local production build at `http://127.0.0.1:3000`. The app remains local; no Vercel deployment was made.

## Direct browser coverage

The desktop checks used separate guest browser sessions. Mobile checks used Chromium at 375 × 812 and 768 × 1024; these are viewport checks, not physical iPhone or Safari tests.

| Area | Actions and observed behavior |
| --- | --- |
| Discovery and collections | Opened grouped collections, searched and cleared filters, selected Pop, Rock and 2010s, and launched Classic with each selected pack. No horizontal overflow at the checked widths. |
| Classic | Played actual audio, used keyboard song selection, submitted a correct and a wrong answer, skipped through all six clip stages, replayed clips, changed volume, and checked reveal/next-round behavior. |
| Daily | Saved attempts, reloaded and resumed, finished the challenge, and checked the copied-result feedback. Automated browser checks separately verify actual clipboard line breaks and UTC rollover. |
| Party | Invited another guest, changed settings, set both players ready, started a round, checked scores/results and leaving, and verified that the listening screen scrolls into view when play starts. |
| Blitz | Played and decoded a real 16-second excerpt; measured duration was 15.984 seconds. Checked skipping and automatic song changes. |
| Duel | Joined through a private invitation in two browser sessions, played seven unanswered rounds to a draw, rematched with fresh songs, submitted a correct keyboard-selected answer, observed the same result in both sessions, reconnected within the grace period, and waited for an actual 30-second disconnect forfeit. |
| Chart Clash | Played higher/lower rounds, checked the revealed counts and final result, and verified that missing artwork does not prevent a choice. |
| Profiles and leaderboards | Opened guest statistics and leaderboards and checked profile editing. |
| Administration | Tried a wrong password, signed in, exercised excerpt validation, edited and restored genre/release metadata, created a custom pack, assigned and removed a song, searched Audius, reimported an existing track, and signed out. The temporary empty QA pack was removed. |

Actual provider playback was checked for the global mix and the Pop, Rock and 2010s packs. Artwork failures and a first-request audio outage were also injected in scoped browser tests; those interceptions were removed after checking recovery. Playlist import was not manually exercised during this pass.

## Fixes made from the checks

- Clearing filters now clears the visible form values as well as the URL.
- Party scrolls to the listening screen after the lobby starts.
- Blitz exposes its full 16-second excerpt on every new song.
- Broken provider artwork falls back to a record illustration or song icon.
- Imports and metadata/availability edits update genre, decade and popularity collections together. Automatic collection membership cannot be overridden through manual assignment; custom packs remain editable.
- Import targets count playable songs, so disabled records no longer prevent the importer from filling the catalog. Previously disabled songs remain disabled on repeated imports.
- Guest controls recover correctly when the shared profile cache loads before a route finishes hydrating.
- Duel explains disconnect forfeits, removes the expired grace message from completed results, puts the authoritative winner first, and shares places for tied scores.
- The local PGlite bridge keeps parallel query cycles and transactions together. A reproduced parameter-binding conflict and frozen error queue are covered by eight isolated protocol/recovery regressions.

## Music connected and organized

The real Audius import grew the playable catalog from 1,000 to **1,500 songs**, with **31 verified provider genres**. Default collections overlap:

| Collection | Playable songs |
| --- | ---: |
| Global mix | 1,500 |
| Hip-hop / rap | 290 |
| Pop | 298 |
| Rock | 194 |
| Alternative / indie | 287 |
| Electronic | 361 |
| 2010s | 61 |
| 2020s | 1,439 |
| Popular on Audius | 200 |

All five Classic difficulty bands were started successfully with the 2010s pack. Decades come from actual release metadata, and popularity means current Audius play counts.

“Syd - Body (Ivy Lab's TW TW Bootleg)” by Ivy Lab (`audius-JaJl0`) failed repeated stream checks despite still being advertised as eligible by the provider. It was reversibly disabled. “Same Girl” by Tess Henley (`audius-E74wM`, R&B/Soul, 2021) was validated as a 16-second MP3 excerpt and imported as a replacement with the same genre and decade. A controlled, isolated Classic session selected that exact replacement; the real browser player decoded 15.984 seconds, started playing, and reported no media error. Its autocomplete entry, correct-answer reveal, ten-point final-stage score and Tess Henley attribution were also checked. PostgreSQL retains 1,501 track records: 1,500 available and one disabled. No source audio files are committed.

Audius offers a [free streaming API](https://docs.audius.co/); imports follow eligibility settings and the provider's [licensing update](https://blog.audius.co/posts/audius-terms-of-service-update). This catalog is not a promise of mainstream commercial hits or music that can be reused without each track's applicable rights.

## Evidence and limits

- [Desktop discovery](runtime-discover-desktop.png)
- [Mobile discovery](runtime-discover-mobile.png)
- [Desktop listening](runtime-classic-desktop.png)
- [Mobile listening](runtime-classic-mobile.png)
- [Desktop Duel forfeit](runtime-duel-forfeit-desktop.png)
- [Mobile Duel forfeit](runtime-duel-forfeit-mobile.png)
- [Replacement song playing through the app](runtime-replacement-audio-desktop.png)
- [Automated verification and commands](runtime-verification.md)

The six modes have direct browser coverage and automated regressions. This does not claim that all 1,500 songs were individually decoded or that physical mobile browsers, offline/background playback or cloud infrastructure were verified. The Frontend Workbench canonical adapter remains blocked on its empty-URL startup on Windows; its 62-state formal delivery acceptance is not claimed.
