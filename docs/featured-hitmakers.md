# 100 hitmakers

The user asked for recognizable major artists instead of the independent Audius Pop collection. This collection includes Kanye West, Drake, Eminem, Travis Scott, Kendrick Lamar, The Weeknd, Rihanna, Taylor Swift, Beyoncé, Lady Gaga, Michael Jackson, ABBA, Queen and other established artists.

See the [complete list of 100 artists and 500 selected recordings](../data/featured-hitmakers.md) or the [machine-readable manifest](../data/featured-hitmakers.json). This is an editorial game selection, not an official worldwide Top 100. Artists carrying `spotifyAllTimeRank` follow [Spotify's published April 2026 all-time list](https://newsroom.spotify.com/2026-04-23/spotify-20-most-streamed-music-podcasts-audiobooks/); other positions are not chart rankings.

## Prepare and import

Use the existing local PostgreSQL/Redis setup described in the project README. Private preview playback requires `DEEZER_PRIVATE_PREVIEWS=true` and a loopback `APP_URL`, such as `http://127.0.0.1:3000`. That flag cannot enable a public hostname; approved public playback has a separate configuration below.

```powershell
bun run catalog:stars
bun run catalog:stars --import
bun run dev
```

Open `http://127.0.0.1:3000/play/classic?pack=featured-hits` to select **100 hitmakers**. The metadata command can also run without a database: `bun scripts/featured-hits.ts`. To prepare more songs per artist, use `--per-artist 10` or `20`; preparation fails explicitly if the provider cannot supply that many eligible originals.

Preparation resolves exact canonical artist names or explicit aliases with an established audience. Songs must have a matching primary artist ID, a readable official HTTPS preview, a popularity rank of at least 100,000 and at least sixteen seconds of duration. Selection rejects tributes, karaoke, unofficial speed variants and live editions, deduplicates reissues and chooses the highest provider ranks. The exported files contain metadata and official track links, never signed CDN URLs or music files.

Only a complete manifest with 100 unique artists and the configured number of songs per artist can be imported. New records receive actual provider album genres and release dates; an editorial artist genre is used only when the provider supplies no genre. Existing disabled records and admin corrections remain intact. All derived packs are organized once after the batch, including genre and decade collections. Reissue dates remain the provider edition dates.

The automatic **100 hitmakers** pack includes all active official previews by the selected artist identities, including records from earlier imports. Its total can exceed the 500-song shortlist. Existing genre packs remain available; Chart Clash continues to use Audius play counts and excludes all Deezer previews.

## Approved public playback

On 2026-10-06 the operator reported obtaining provider approval for the public game at `https://guessthesong-rust.vercel.app`. The application does not independently verify that agreement. Open-source code does not license the recordings or transfer that approval to other installations.

For an application with the necessary provider approval, set these values only in its Production environment:

```dotenv
APP_URL=https://guessthesong-rust.vercel.app
DEEZER_PRIVATE_PREVIEWS=false
DEEZER_PUBLIC_PREVIEWS_APPROVED=true
DEEZER_PUBLIC_PREVIEWS_ORIGIN=https://guessthesong-rust.vercel.app
```

The approval origin must match the exact HTTPS application origin, without credentials, a path, query or fragment. A missing or mismatched approval disables catalog selection and audio, even when clips are cached. Deployment preparation reports an invalid enabled configuration before starting the build. Preview environments and forks remain disabled by default.

Use the prepared metadata shortlist with a separate ignored environment file containing the intended production database and configuration:

```powershell
bun run --env-file=.data/production-deployment/production.env scripts/featured-hits.ts --import
```

Do not run the local `catalog:stars` shortcut against production. Import fetches fresh provider metadata for new records, preserves disabled tracks and admin corrections, and reports actual imported totals under ignored `.data/featured-hits/import-report.json`. The manifest's `productionActivated: false` and `playbackScope: private-local` describe its original preparation state; the manifest itself grants no permission and does not control environment activation. The import report records the configured playback scope; live deployment still requires verification.

Playback continues to require readable official previews, a permitted HTTPS provider CDN, fresh URLs and authenticated, session-bound clips. No signed CDN URLs or audio recordings are committed. Source links and attribution appear on reveal. Availability and region restrictions still apply.

Catalog managers can use `GET /api/v1/admin/deezer/search?q=...` and `POST /api/v1/admin/deezer/check` with `{ "trackIds": ["deezer-123"] }`. Both require an existing authenticated admin session; verification accepts at most twenty provider IDs and checks fresh metadata plus a real one-second server-bounded clip from the deployment itself. Search exposes canonical artist/album IDs and metadata, never signed CDN URLs. Confirm canonical artists and eligible editions before importing returned metadata. A failed check grants no playable status and must not re-enable an admin-disabled record.

Local provider availability can differ from the hosting region. Initial hosted checks found **445 playable clips and 55 unavailable editions** in the 500-record local selection. Those editions were disabled in the production catalog; replacement recordings are checked from Vercel before import. This is a provider availability boundary, not a reason to bypass region restrictions.

## Actual verification — 2026-10-06

- Metadata preparation completed with **100 artists and 500 distinct selected recordings**.
- The private local import added **183 records** and reused **317**. All **500/500 selected recordings** are active in the derived pack; every artist has at least five records. No imports failed.
- The local **100 hitmakers** pack contains **1,903 records** after including previous imports. This is a local database count, not the production catalog count.
- **104 bounded MP3 availability checks passed**: one selected recording from every artist plus the other four selected Kanye West songs. Checks verified fresh primary artist IDs, HTTP audio responses and MPEG signatures; they did not download whole recordings or test all 1,903 tracks.
- Browser smoke verification exercised pack selection, creating a real Classic round, loading its one-second clip, searching for **I Fall Apart — Post Malone**, selecting it and submitting the correct answer. The server awarded **100 points** and the reveal displayed the original artist, source link and private-preview attribution. The expected answer came from the agent-created local QA session. No browser warnings or errors were reported during this flow.
- Relevant catalog, provider and selection tests: **48 passed, 0 failed**. TypeScript validation, lint for changed source files and the optimized Next.js production build passed.

Local import and audio reports are under ignored `.data/featured-hits/`. They are diagnostics, not database credentials or deployment settings.

## Missing originals and public playback

The initial artist selection only returned 457 eligible records: twelve artists did not have five readable primary-artist previews in the provider response. Those names, including Ed Sheeran, Dua Lipa, Bruno Mars and Coldplay, appear in the manifest's `deferredArtists` section with the actual latest counts. They were replaced in the selected 100 by other recognizable artists with available originals; covers and incorrectly relabeled collaborations were not used. This records observed availability, not a claim about why particular catalogs are missing.

Deezer's [developer terms](https://developers.deezer.com/termsofuse) restrict content streaming and use to private family use and require advance review for uses outside the described scope. The preview endpoint being technically accessible does not authorize public game playback. Public activation relies on the operator's reported provider approval for this application, using the explicit settings above.

## Verification commands

```powershell
bun test tests/featured-hits.test.ts tests/catalog-packs.test.ts tests/deezer.test.ts
bun run typecheck
bunx eslint scripts/featured-hits.ts scripts/music-sources/featured-hits.ts src/shared/featured-artists.ts src/server/catalog-packs.ts tests/featured-hits.test.ts tests/catalog-packs.test.ts
bun run build
```
