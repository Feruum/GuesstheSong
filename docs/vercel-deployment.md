# Deploying this repository to Vercel

The GitHub repository is connected to Vercel. Publishing code does not transfer the local database, guest profiles or Redis state. On 2026-10-06 the public deployment returned `503 NOT_CONFIGURED` because `DATABASE_URL` was missing; live gameplay remains unverified until cloud configuration is connected.

## Project and runtime

Import `Feruum/GuesstheSong` into Vercel with the Next.js preset and the repository root as the project directory. The committed `vercel.json` uses `bunVersion: "1.4.x"`, `bun install --frozen-lockfile` and `bun run deploy:prepare && bun run build`. These settings follow the [official Bun runtime documentation](https://vercel.com/docs/functions/runtimes/bun). Keep the committed lockfile and remove any dashboard override that bypasses the preparation command.

Vercel runs Next.js functions itself. `bun run start` is the local coordinator for a Next.js process and a separate Bun WebSocket process; it is not a Vercel startup command.

## Web Analytics

`@vercel/analytics` is installed and locked with Bun. The root layout imports `Analytics` from `@vercel/analytics/next` and renders it once on Vercel; local development does not request Vercel-only analytics endpoints. It tracks page navigation using the official Next.js integration, without adding custom game events or player identities.

In the Vercel project dashboard, open Web Analytics and click Enable, then deploy this commit and visit the site. Verify page views in the dashboard; content blockers can prevent collection. The component is wired into the application, but collection in a hosted dashboard has not yet been verified. Follow the [official Web Analytics quickstart](https://vercel.com/docs/analytics/quickstart?framework=nextjs).

## Cloud database and secrets

Create a PostgreSQL database, such as Neon, and a Redis database, such as Upstash. This app uses `pg` and `ioredis`: use a PostgreSQL connection string with provider-required TLS and the Redis **TCP/TLS URL** (`rediss://...`), rather than a REST URL/token. The local PGlite and WSL Redis addresses in the example file are for development only.

Configure these in Vercel's environment settings:

| Variable | Production value |
| --- | --- |
| `DATABASE_URL` | Cloud PostgreSQL connection string with `sslmode=require` or certificate verification |
| `REDIS_URL` | Cloud Redis TCP/TLS connection string |
| `APP_URL` | Exact HTTPS production origin, including the final domain |
| `SESSION_SECRET` | Fresh random secret, at least 32 characters |
| `ADMIN_PASSWORD_HASH_BASE64` | Base64-encoded Argon2 hash from `bun run admin:password` |
| `CRON_SECRET` | Fresh random secret for the configured catalog refresh cron |
| `AUDIUS_APP_NAME` | `guess-the-song` |
| `AUDIUS_API_KEY` | Optional provider key, if available |
| `DEEZER_PRIVATE_PREVIEWS` | `false` for public hosting |
| `REDIS_NAMESPACE` | A distinct value, such as `gts-production` |

Do not commit environment values or the admin password. `.env.example` documents names and local placeholders only. Use separate databases, Redis namespaces and session secrets for preview environments; set each preview's `APP_URL` to its own exact origin. Mutations validate the browser's origin.

`DATABASE_URL`, `REDIS_URL`, `APP_URL` and `SESSION_SECRET` are required by deployment preparation. It rejects missing values, loopback/private development addresses, a REST Redis URL and insecure connection protocols before opening connections. It then checks actual PostgreSQL and Redis connectivity. Missing configuration fails the deployment with variable names in the build log; secrets are never printed. `ADMIN_PASSWORD_HASH_BASE64` and `CRON_SECRET` are also needed for their respective protected features.

## Initialize the production catalog

After connecting cloud environment values, push or redeploy. `deploy:prepare` applies the repeatable SQL migrations and initializes a new, empty database from [the public starter catalog](../catalog/README.md): **1,500 Audius recordings**, organized by verified genre and release-year metadata. It stores metadata only; audio still comes from the provider through session-bound clips.

Schema creation, the initial import and automatic pack membership run in one PostgreSQL transaction with an advisory lock, so concurrent deployment workers cannot seed twice. A completion record makes the import run once per database. Existing catalogs are preserved, including disabled recordings, administrative corrections, guest stats and manual packs. Failed initialization rolls back and can be retried. Redis readiness is checked before any migration.

The existing `db:migrate`, `catalog:import 1500` and admin importer remain available for maintenance. For CLI access to production, use an isolated checkout and production-specific ignored environment file, keeping this computer's development configuration intact. `bun run build` by itself remains a local build and does not initialize cloud services.

The 3,500 familiar-artist Deezer previews in the local database are excluded from the committed starter snapshot and restricted to private, noncommercial loopback play. Public configuration hides them and rejects their audio even if copied into the database. See the [source details](../README.md#familiar-songs-for-private-local-play) and [official provider terms](https://developers.deezer.com/termsofuse). Public familiar-hit gameplay requires an independently authorized music source.

## Multiplayer integration still required

The committed Party/Duel transport is the verified local Bun server at `src/server/socket-server.ts`. `next.config.ts` proxies `/api/ws` to its localhost port. That second process does not exist inside a normal Vercel Next.js deployment, so the current local rewrite is not a production multiplayer integration.

Vercel documents an experimental Next.js `experimental_upgradeWebSocket` API from `@vercel/functions`; see the [official WebSocket guide](https://vercel.com/docs/functions/websockets). Before enabling public Party/Duel, add and deployment-test that route adapter, replace the local proxy only for Vercel, and preserve the existing session authentication, Redis authority/pubsub, presence expiry, rotation and reconnect behavior. The installed dependency contains this API, but the application does not yet implement or verify the Vercel adapter. Keep Fluid compute enabled as required by the provider.

Do not assume that a successful build proves WebSocket compatibility. The existing local cross-instance and 24-player tests are the regression baseline; repeat them against the actual hosted adapter, including forced disconnects and function rotation.

## Verify the deployment

After environment settings, migrations and catalog initialization, deploy and check `/api/v1/health`, discovery, genre packs, Classic, Daily persistence, real bounded Audius playback, result storage and admin authentication. Test preview/production isolation and the cron's bearer secret. Test Party/Duel only after the hosted transport is implemented and verified.

The dated [local verification](../design/runtime-verification.md) and [familiar-song checks](../design/hits-verification.md) describe what has actually passed. They do not establish a verified public deployment.
