# Featured Hitmakers Implementation Plan

**Goal:** Prepare 100 canonical major artists and 500 original song candidates, with a complete-list export and a playable private-local collection.

**Architecture:** A shared explicit artist roster, pure provider selection/manifest validation helpers, a Bun preparation/import command, and a derived catalog pack. Reuse the current Deezer adapter and its private-use gate.

**Tech Stack:** Bun, TypeScript, Zod, existing PostgreSQL/Drizzle catalog helpers.

Execute inline in the already authorized checkout. The user has repeatedly asked to complete and push the work without additional confirmation; public audio permission is an external limitation, not permission to remove the source restrictions.

1. Add tests for 100 unique identities, Kanye West inclusion, rejecting lookalike artist accounts, incompatible/tribute/live recordings, reissue deduplication, retaining Live Your Life, and rejecting incomplete manifests. Run them before implementation.
2. Add `src/shared/featured-artists.ts` for the roster and identity normalization. Add `scripts/music-sources/featured-hits.ts` for canonical artist resolution and song/manifest validation; exported metadata excludes CDN URLs.
3. Add `scripts/featured-hits.ts` and `catalog:stars` in package.json. Query existing cached canonical identities and fresh artist top-song metadata with spaced requests; export each artist's five real songs and failures. The import option requires the complete validated list and loopback preview opt-in before touching PostgreSQL.
4. Add the `featured-hits` automatic pack in `src/server/catalog-packs.ts`. Select only active official previews whose canonical artist name is on the roster; test exclusions and aliases. Keep public catalog filtering intact.
5. Run real preparation, representative audio samples and private-local import. Reuse existing tracks and provider album metadata, then organize packs once. Verify counts and missing artists with SQL; produce a readable full list under docs, with the exact actual totals and separate production status.
6. Run relevant unit/catalog/provider tests, TypeScript and lint. Review the exact diff and public restrictions, commit and push, then report the source limitation and concrete list without claiming that famous hits are publicly playable.

Verification on 2026-10-06: complete 100-artist/500-song manifest; 183 new imports and 317 reused records; 500 selected records active and 1,903 records in the local derived pack; 104/104 bounded audio samples passed; browser Classic playback/search/correct-answer reveal passed; 48/48 relevant tests, source lint, TypeScript and optimized production build passed. The initial twelve artists with insufficient original previews remain listed explicitly in `deferredArtists`. Public hit playback is still outside this provider's authorized scope.
