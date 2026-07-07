# Working in mytube (agents & humans)

Self-hosted personal YouTube frontend: videos are downloaded locally with
**yt-dlp** and watched through a clean, ad/sponsor-free UI. Single user, single
process, SQLite. This file is the orientation for a fresh session — read it
before making changes. User-facing setup/deploy lives in [README.md](./README.md);
the HTTP surface is [docs/API.md](./docs/API.md).

## Stack & shape

- **SvelteKit** (Svelte 5 runes, TypeScript) + **adapter-node** — UI *and* API
  in one Node process. Tailwind, dark-only.
- **SQLite** via **Drizzle ORM** (`better-sqlite3`, WAL). Single file in `/data`.
- **yt-dlp** + **ffmpeg** as subprocesses. **Playwright/Chromium** only for the
  optional recommended-feed module (dynamically imported).
- Background work = **in-process, DB-backed queues + a worker loop**. No Redis.
  Everything survives restarts.

## Verify before claiming done

```bash
pnpm check   # svelte-check — expect 0 errors (see "warnings" gotcha below)
pnpm build   # adapter-node → build/index.js
pnpm test    # vitest (pure-logic unit tests)
```

For anything touching the download/stream/feed pipeline, also validate against a
**real** yt-dlp run (see "Dev loop"). Don't trust "it compiles" for pipeline code.

## Dev loop

```bash
pnpm install          # native better-sqlite3 build — see gotcha #1 if it fails
pnpm dev              # http://localhost:5173
pnpm db:generate      # regenerate migration SQL after editing schema.ts
```

The pipeline needs `yt-dlp` + `ffmpeg` on PATH (tests don't). To exercise it
without global installs, drop a `yt-dlp` binary and a static `ffmpeg` in a dir,
then run the built server with `PATH=<bin>:$PATH YTDLP_PATH=<bin>/yt-dlp
MEDIA_ROOT=… DATABASE_PATH=… node build/index.js`. That's how the pipeline was
validated end-to-end against real YouTube.

## Architecture

Config split: **`config.ts`** = env (deploy-time: ports, paths, flags, secrets).
**`settings.ts`** = DB-backed, typed `AppSettings` (runtime-tunable: quality,
cleanup, SponsorBlock, feed intervals), cached, edited via the Settings UI.
Secrets never go in `settings` — that object is sent to the browser.

Two queues, both restart-safe, both driven by `worker.ts` intervals:
- **`downloads` table** — the download queue (rich progress columns), worked by
  `downloads.ts` (max-2 concurrent, backoff retries, crash recovery).
- **`jobs` table** — everything else (RSS poll, lazy metadata, feed expiry,
  cleanup, recommended scrape, history sync, playlist sync/remove). `jobs.ts` is
  the generic engine; handlers are registered in `job-handlers.ts`;
  `scheduler.ts` decides what's *due* and enqueues it.

`bootstrap.ts` (from `hooks.server.ts`) runs migrations then `startWorkers()`.

### Server module map (`src/lib/server/`)

| Module | Responsibility |
|---|---|
| `config.ts` / `settings.ts` | env config / DB-backed typed settings |
| `db/schema.ts` | all tables + types. Edit → `pnpm db:generate` → auto-applied on boot |
| `db/index.ts` / `db/migrate.ts` | shared connection / migrator |
| `bootstrap.ts` / `worker.ts` / `scheduler.ts` | startup / interval loops / due-work decisions |
| `jobs.ts` / `job-handlers.ts` | generic job queue / handler registry + watched hook |
| `downloads.ts` | download queue: enqueue, claim, process, retry |
| **`ytdlp.ts`** | **the only place that spawns yt-dlp** — all flags/format logic |
| `sponsorblock.ts` | SponsorBlock API (hash-prefix privacy) |
| `media.ts` / `serve.ts` | media paths (traversal-guarded) / HTTP range serving |
| `slug.ts` / `youtube-url.ts` | FS-safe channel slug / URL parsing (tested) |
| `rss.ts` / `feed.ts` / `channels.ts` | RSS parse (tested) / feed ingest+actions / channel mgmt + Takeout CSV (tested) |
| **`recommended.ts`** | **the only place that parses YouTube home-page JSON** — drift-resistant, fixture-tested |
| `recommended-scraper.ts` | Playwright driver (dynamically imported) |
| `lifecycle.ts` | watched toggle + cleanup policies + watched hook |
| `storage.ts` | storage-dashboard accounting |
| `playlist-sync.ts` / `youtube-api.ts` / `google-auth.ts` | Data-API playlist loop / API client / OAuth |
| `history-sync.ts` | `yt-dlp --mark-watched` write-back |
| `auth.ts` | token/session auth (bearer + HMAC cookie) |
| `events.ts` / `library.ts` | SSE event bus / library+download queries |

**Isolation is deliberate:** YouTube breaks constantly, so all yt-dlp flags live
in `ytdlp.ts` and all home-feed JSON parsing in `recommended.ts` (with fixtures).
Fix drift in one file. Don't spread yt-dlp calls or `ytInitialData` parsing.

### Conventions

- `video_id` (YouTube's 11-char id) is the canonical key **everywhere**; numeric
  PKs are ergonomics only. Channel slugs are cosmetic + FS-safe; never trust a
  name for a path (`media.ts` guards traversal).
- Timestamps: integer **unix-ms UTC** in DB (`{ mode: 'timestamp_ms' }` → `Date`).
  Localize only in the UI.
- Optional modules are flag-gated and inert when off: `RECOMMENDED_FEED_ENABLED`
  (Playwright), `HISTORY_SYNC_ENABLED`, and playlist sync (needs OAuth + a chosen
  playlist). Auth enforces only when `AUTH_TOKEN`/`AUTH_PASSWORD` is set.
- Many small modules over big ones. Keep functions <50 lines where reasonable.

## How to extend

- **New setting:** add to `AppSettings` + `DEFAULT_SETTINGS` in `settings.ts`,
  then surface it in `settings/+page.*`. Never store secrets there.
- **New job type:** add to `jobs.type` enum in `schema.ts` → `pnpm db:generate`;
  register a handler in `job-handlers.ts`; enqueue from `scheduler.ts` (if
  periodic) or inline. Handlers get backoff/retry for free.
- **New download behavior:** change flags in `ytdlp.ts` only; wire options through
  `downloads.ts`.
- **Schema change:** edit `schema.ts` → `pnpm db:generate` → migration auto-runs
  on next boot. Migrations are committed under `drizzle/`.
- **New API route:** a SvelteKit `+server.ts`. Auth is applied globally in
  `hooks.server.ts`; only add a path to `PUBLIC_PATHS` if it must be unauthed.
- **Player features:** `src/lib/components/Player.svelte` (custom controls,
  seekbar, SponsorBlock, shortcuts). Clickable timestamps call the exported
  `seekTo`.

## Gotchas (things that actually bit us)

1. **pnpm native-build gate.** `better-sqlite3` needs `onlyBuiltDependencies` in
   `pnpm-workspace.yaml`. The **Dockerfile must `COPY pnpm-workspace.yaml`** into
   the build stage *before* `pnpm install`, or install hard-fails
   (`ERR_PNPM_IGNORED_BUILDS`). If a local install ignores builds, that file is
   why.
2. **Docker default target.** The Dockerfile has `runtime` **and**
   `runtime-chromium`; a bare `docker build` builds the *last* stage
   (chromium, huge). CI and compose pin `target: runtime`.
3. **`ORIGIN` behind a proxy.** Set it to the public HTTPS origin or SvelteKit's
   CSRF check 403s every form action. It also drives the OAuth redirect URI and
   the Secure cookie. Behind Cloudflare also set `ADDRESS_HEADER=CF-Connecting-IP`.
4. **YouTube "Watch Later" is not API-accessible** (deprecated 2016). Playlist
   sync uses a *normal* playlist, read/removed via the Data API.
5. **OAuth refresh token expires in 7 days** while the consent screen is in
   "Testing" with the sensitive `youtube` scope. Publish **In production**.
6. **SponsorBlock mode.** `remove` (default) cuts segments from the file at
   download (`ytdlp.ts` `--sponsorblock-remove`); `skip` keeps the file and skips
   in the player. When removing, don't store skip-segments (timestamps shift).
7. **SQLite on NFS is unsafe** (locking). `/data` (DB) stays local; `/media`
   (videos) can be NFS. Authed media responses use `Cache-Control: private` so a
   shared proxy can't cache-bypass auth.
8. **`redirect()` returns `never`** — in `+server.ts` handlers `return redirect(...)`.
9. **svelte-check warnings.** ~8 `state_referenced_locally` warnings are
   intentional (local state seeded once from a prop). Target is **0 errors**, not
   0 warnings. Don't "fix" them into reactivity you don't want.
10. **yt-dlp is pinned** in the Dockerfile (`YTDLP_VERSION`). Extractor breakage
    is the #1 failure mode — bump the pin when downloads start failing; the
    Settings page also has a self-update button.

## Deployment (brief)

CI (`.github/workflows/docker.yml`) builds `ghcr.io/bigsaam/mytube:latest`
(public) on push to `main`. Runtime deploy config is **not here** — it lives in
the separate `config` repo at `homelab/utils/mytube/` (compose + tunnel route),
running on `manz-utils` at `https://mytube.enzoiwith.us` behind the utility
Cloudflare Tunnel. It uses **its own token auth, not Authentik** (it's an
API/device-client app). See that repo for host specifics.

## Non-goals (v1)

No transcoding/HLS, no multi-user, no comments. The only writes back to YouTube
are the optional watched-history ping and playlist-item removal on watched.
