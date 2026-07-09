# Recommended feed — build handoff

Status of the "Discover / recommended feed" flywheel and what's left. Pick this
up cold in a new session. Last updated after **P1b** (commit `6f5b740`).

## TL;DR

| Phase | What | Status |
|---|---|---|
| **P0** | Enable it on prod (Chromium image, flag, cookies) | ✅ except **cookies** (your action) |
| **P1a** | Dedicated `/discover` surface + pool table | ✅ shipped (`4e32a0c`) |
| **P1b** | On-demand **Refresh** (rate-capped) | ✅ shipped (`6f5b740`) |
| **P1c** | Stream-and-discard (`ephemeral` videos) | ⬜ TODO |
| **P2** | Up-next rabbit hole (watch-page related) | ⬜ TODO — do **after** real data exists |
| **P3** | Flywheel (history-sync) + quality (diversity/freshness/not-interested) | ⬜ TODO |

## ⛳ The one thing gating real recommendations: cookies

The scraper logs into **your** YouTube with your cookies. Until they're uploaded,
`/discover` is empty (it shows a guided empty state).

1. On your **laptop** (headful browser), install **"Get cookies.txt LOCALLY"**,
   go to youtube.com **logged in**, export `cookies.txt`.
2. Get it onto prod — either:
   - **Easiest:** open MyTube at your prod URL → **Settings → Recommended feed** →
     upload the file (it's written to `/data/cookies.txt` in the container), **or**
   - **scp** it directly onto the prod VM's mounted `/data` volume as `cookies.txt`
     (path in-container: `config.cookiesPath` = `<DATA_ROOT>/cookies.txt`).
3. Open `/discover` → **Refresh** to pull the first batch immediately (otherwise the
   scheduler runs 2–4×/day).

The same `cookies.txt` also feeds yt-dlp (`--cookies`) for age-gated/members videos.

> **Local-dev testing with real scrapes** (this dev machine): scp `cookies.txt`
> into `./data/cookies.txt`, `pnpm exec playwright install chromium`, set
> `RECOMMENDED_FEED_ENABLED=true`, run the built server. A headful capture of a
> real `ytInitialData` / watch-page `/next` response is the best way to build P2
> fixtures (see below).

## Validation checklist (once cookies are up)

- [ ] `/discover` populates after a Refresh (or scheduled scrape).
- [ ] Settings → Recommended feed shows status `ok` (not a consent/captcha banner).
- [ ] Grab / Watch Later / Dismiss work; grabbed items leave the pool + appear in Library.
- [ ] Capture a real watch-page JSON fixture for P2 parser tests before building P2.

## What's deployed / how it's wired

- **Image:** prod runs `ghcr.io/bigsaam/mytube:chromium` (NOT `:latest` — the slim
  default has no browser). CI (`.github/workflows/docker.yml`) publishes both.
- **DB:** migration `0005_deep_cargill.sql` added the `recommendations` pool table.
- **Deploy flow:** push `main` → CI builds `:latest` + `:chromium` → ask the
  homelab deployment agent over **Paseo** to `docker compose pull && up -d`
  (it tracks `:chromium`):
  ```bash
  paseo ls -g                       # find the `mytube-deployment` agent id
  paseo send <agent-id> "<deploy request>"   # blocks until it replies
  ```
  ⚠️ **Prod self-updates.** Watchtower watches the rolling `:chromium` tag, so a
  push to `main` deploys itself once CI publishes — and any DB migration
  auto-applies on that pull, deploy request or not. Pin `:sha-<commit>-chromium`
  if you want deploys to be the only thing that moves prod.

### Module map (recommended feed)

| File | Role |
|---|---|
| `src/lib/server/recommended.ts` | **Pure parser** of YouTube JSON (deep-walks `videoRenderer`). Drift-resistant, fixture-tested. |
| `src/lib/server/recommended-scraper.ts` | Playwright driver (dynamic import). Home-page scrape, cookie seeding, wall detection. |
| `src/lib/server/discover.ts` | The pool: `ingestRecommended`, `listRecommendations` (id-cursor), grab/dismiss, `requestManualScrape` (rate cap). |
| `src/lib/server/db/schema.ts` | `recommendations` table (`source`/`sourceVideoId`/`rank`/`status`). |
| `src/routes/discover/*` | The surface: grid, Load more, Refresh, actions. |
| `src/routes/api/recommended/*` | `GET` (paginate), `POST` (actions), `POST /refresh`. |
| `src/lib/server/scheduler.ts` | Schedules `recommended_scrape` 2–4×/day. |
| `src/lib/server/job-handlers.ts` | Registers `recommended_scrape` handler + hooks. |

Flow: `scheduler`/Refresh → `recommended_scrape` job → `runRecommendedScrape`
(Playwright) → `extractRecommended` (parse) → `ingestRecommended` (pool, deduped
vs library + pool) → `/discover`.

## Remaining work (build-ready notes)

### P1c — stream-and-discard
Goal: watch a recommendation without permanently keeping it.
- Schema: add `videos.ephemeral` boolean (new migration).
- `downloads.ts`: thread `ephemeral` through `EnqueueOptions` → the `videos` insert.
- `discover.ts` + `/api/recommended`: a `watchNow` action → `grabRecommendation`
  with `ephemeral: true`; return the `videoId` so the client can navigate to
  `/watch/<id>` (the watch page already renders the downloading state).
- `lifecycle.ts` `runCleanupSweep`: add a pass pruning **watched + ephemeral +
  unpinned** videos (mirror the playlist-queue pass). **Keep** (pin) exempts it;
  optionally also clear `ephemeral` on Keep.
- Discover card: a "Watch now" button beside "Download".

### P2 — up-next rabbit hole (do after real data)
Goal: watching a video seeds more recommendations (the endless chain).
- Parser: extend `recommended.ts` to also collect `compactVideoRenderer` and
  `lockupViewModel` (watch-page up-next shapes) — **capture a real fixture first**
  (headful browser) and add a `recommended.upnext.test.ts`.
- Scraper: `scrapeWatchNext(videoId)` — load `watch?v=<id>`, capture `ytInitialData`
  + `/youtubei/v1/next`, extract related, `ingestRecommended(items, {source:'upnext',
  sourceVideoId})`.
- Job: add `upnext_scrape` to the `jobs.type` enum (TS-only, no migration);
  register a handler; **trigger from the watched-hook** (`setWatchedHook` in
  `job-handlers.ts`), rate-capped / deduped per video. Add a per-card
  "More like this" that enqueues it on demand.
- Politeness: cap up-next scrapes (e.g. per hour) — more scrape surface = more
  drift + cookie burn.

### P3 — flywheel + quality
- **Flywheel:** ensure `HISTORY_SYNC_ENABLED` is on — watching locally pings
  YouTube history → better personalization → better scrapes. Surface a Settings
  nudge (offer to enable it alongside the feed) and document the loop.
- **Quality:** channel-diversity cap in `listRecommendations` ranking; freshness
  decay / expiry of stale `new` pool rows (a cleanup pass); **"Not interested"**
  action (`status='not_interested'` + optional per-channel blocklist that
  `ingestRecommended` honors); min-duration filter setting.

## Gotchas

- **Must run the `:chromium` image** for the feed; `:latest` has no browser
  (`browser.launch` fails). The `runtime-chromium` Dockerfile target installs
  Chromium to `/ms-playwright` (fixed in `a72f7e3`).
- **Parser drift is the #1 risk.** Keep all YouTube-JSON parsing in
  `recommended.ts` with fixtures. Never spread `ytInitialData` parsing elsewhere.
- **Rate limits:** scheduled 2–4×/day; manual Refresh capped to 1 / 5 min. Keep
  "endless" fed from the stored pool, not by hammering YouTube.
- **Cookies expire / consent walls:** the scraper pauses and shows a Settings
  banner rather than retry-hammering. Re-upload fresh cookies when that happens.
