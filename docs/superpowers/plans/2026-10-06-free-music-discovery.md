# Free Music Discovery Implementation Plan

> Execute inline in the existing authorized project checkout. No agents are needed.

**Goal:** Deliver free API adapters, an Incompetech page/JSON parser, a Bun discovery command, and reproducible live evidence.

**Architecture:** Pure normalizers under `scripts/music-sources/`, a shared bounded HTTP client and license policy, and `scripts/discover-music.ts` for user-facing commands. Keep this tooling independent of the deployed game runtime and PostgreSQL.

**Tech Stack:** Bun, TypeScript, the existing Zod dependency, built-in fetch and bun:test. Read the installed Next.js fetching/route guides before code, as required by AGENTS.md.

## Tasks

1. Add `tests/music-discovery.test.ts`. Assert that default policy rejects NC/ND/unknown licenses, parser preserves credits and real dates, and unauthorized URLs never trigger a fetch. Run `bun test tests/music-discovery.test.ts` and record its initial failure.
2. Implement `scripts/music-sources/shared.ts`: normalized record schema, license selection, duration parsing, HTTPS provider allowlists, bounded JSON/audio requests, errors with HTTP status and Retry-After, and audio-asset deduplication. Do not treat publication dates as release dates.
3. Implement `scripts/music-sources/incompetech.ts`, `commons.ts`, `ccmixter.ts` and `openverse.ts`. Add provider fixtures/tests before each adapter. Use exactly the observed documented fields; skip bad records independently. Extract only the `genres` JSON array from the Incompetech page. Commons must retain `Artist`, `Credit` and licensing metadata and prefer an existing MPEG derivative. ccMixter must preserve featured creators.
4. Implement `scripts/discover-music.ts` and `music:discover` in `package.json`. Support source, query, limit, explicit NC policy, output and optional bounded audio verification. Search errors are individually reported; if every requested source fails, exit unsuccessfully. Output counts distinguish fetched rows, accepted rows, selected rows and verified audio.
5. Run unit tests, typecheck and lint. Fix failures before proceeding. Run real Incompetech, Commons, ccMixter and Openverse queries, using a small shortlist and serialized audio checks. Save evidence under ignored `.data/music-discovery/` and report exact results, not theoretical catalog size as playable count.
6. Write `docs/free-music-apis.md` with free API URLs, query examples, observed counts, source restrictions and parser commands. Keep Internet Archive timeouts, Jamendo registration and MusicBrainz's lack of audio explicit. Inspect the diff, exclude credentials/cached media, commit and push to the existing GitHub remote.

## Verification commands

```powershell
bun test tests/music-discovery.test.ts
bun run typecheck
bun run lint
bun run music:discover --source incompetech --query "Sneaky" --verify-audio --output .data/music-discovery/sneaky.json
bun run music:discover --source commons --query "File:Moonlight.ogg" --verify-audio --output .data/music-discovery/moonlight.json
bun run music:discover --source ccmixter --query "hip_hop" --limit 5 --verify-audio --output .data/music-discovery/hip-hop.json
bun run music:discover --source openverse --query "Monkeys Spinning Monkeys" --limit 5 --verify-audio --output .data/music-discovery/monkeys.json
```

Completion means tested discovery/export tooling and an honest provider report. It does not mean importing unreviewed songs into production or enabling arbitrary copyrighted previews.
