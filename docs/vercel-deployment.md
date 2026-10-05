# Deploying this repository to Vercel

This repository contains the complete local application. Publishing it to GitHub does not transfer the local database, guest profiles or Redis state. A Vercel production deployment has not been verified.

## Project and runtime

Import `Feruum/GuesstheSong` into Vercel with the Next.js preset and the repository root as the project directory. The committed `vercel.json` uses `bunVersion: "1.4.x"`, `bun install --frozen-lockfile` and `bun run build`. These settings follow the [official Bun runtime documentation](https://vercel.com/docs/functions/runtimes/bun). Keep the committed lockfile.

Vercel runs Next.js functions itself. `bun run start` is the local coordinator for a Next.js process and a separate Bun WebSocket process; it is not a Vercel startup command.

## Web Analytics

`@vercel/analytics` is installed and locked with Bun. The root layout imports `Analytics` from `@vercel/analytics/next` and renders it once on Vercel; local development does not request Vercel-only analytics endpoints. It tracks page navigation using the official Next.js integration, without adding custom game events or player identities.

In the Vercel project dashboard, open Web Analytics and click Enable, then deploy this commit and visit the site. Verify page views in the dashboard; content blockers can prevent collection. The component is wired into the application, but collection in a hosted dashboard has not yet been verified. Follow the [official Web Analytics quickstart](https://vercel.com/docs/analytics/quickstart?framework=nextjs).

## Cloud database and secrets

Create a PostgreSQL database, such as Neon, and a Redis database, such as Upstash. This app uses `pg` and `ioredis`: use a PostgreSQL connection string with provider-required TLS and the Redis **TCP/TLS URL** (`rediss://...`), rather than a REST URL/token. The local PGlite and WSL Redis addresses in the example file are for development only.

Configure these in Vercel's environment settings:

| Variable | Production value |
| --- | --- |
| `DATABASE_URL` | Cloud PostgreSQL connection string |
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

## Initialize the production catalog

On a trusted development computer, use a separate checkout with `.env.local` pointing to the production databases and the final `APP_URL`. Do not replace this project's existing local settings merely to deploy. Then run:

```powershell
bun install --frozen-lockfile
bun run db:migrate
bun run catalog:import 1500
```

Migrations are repeatable. The importer contacts Audius, reports the actual available total and organizes supported genre and decade collections. It preserves disabled recordings and existing administrative metadata. Run this before directing public users to the app; importing is a CLI initialization task, not part of every build. The local database and its 5,000-song total are not bundled into this repository.

The 3,500 familiar-artist Deezer previews in the current local database are restricted to private, noncommercial loopback play. Public configuration hides them and rejects their audio even if copied into the database. See the [source details](../README.md#familiar-songs-for-private-local-play) and [official provider terms](https://developers.deezer.com/termsofuse). Public familiar-hit gameplay requires an independently authorized music source.

## Multiplayer integration still required

The committed Party/Duel transport is the verified local Bun server at `src/server/socket-server.ts`. `next.config.ts` proxies `/api/ws` to its localhost port. That second process does not exist inside a normal Vercel Next.js deployment, so the current local rewrite is not a production multiplayer integration.

Vercel documents an experimental Next.js `experimental_upgradeWebSocket` API from `@vercel/functions`; see the [official WebSocket guide](https://vercel.com/docs/functions/websockets). Before enabling public Party/Duel, add and deployment-test that route adapter, replace the local proxy only for Vercel, and preserve the existing session authentication, Redis authority/pubsub, presence expiry, rotation and reconnect behavior. The installed dependency contains this API, but the application does not yet implement or verify the Vercel adapter. Keep Fluid compute enabled as required by the provider.

Do not assume that a successful build proves WebSocket compatibility. The existing local cross-instance and 24-player tests are the regression baseline; repeat them against the actual hosted adapter, including forced disconnects and function rotation.

## Verify the deployment

After environment settings, migrations and catalog initialization, deploy and check `/api/v1/health`, discovery, genre packs, Classic, Daily persistence, real bounded Audius playback, result storage and admin authentication. Test preview/production isolation and the cron's bearer secret. Test Party/Duel only after the hosted transport is implemented and verified.

The dated [local verification](../design/runtime-verification.md) and [familiar-song checks](../design/hits-verification.md) describe what has actually passed. They do not establish a verified public deployment.
