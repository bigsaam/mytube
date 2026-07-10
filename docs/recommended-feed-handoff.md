# Recommended feed — build handoff

Status of the "Discover / recommended feed" flywheel and what's left. Pick this
up cold in a new session. Last updated after **P1b** (commit `6f5b740`).

## TL;DR

**The feed is LIVE and working end-to-end on prod** (verified `faf39af`, 2026-07-09):
cookie upload → persistent Chromium profile → logged-in YouTube home →
`lockupViewModel` parse → ads rejected → 23 items ingested → `/discover` populated.

| Phase | What | Status |
|---|---|---|
| **P0** | Enable it on prod (Chromium image, flag, cookies) | ✅ **done & verified** |
| **P1a** | Dedicated `/discover` surface + pool table | ✅ shipped (`4e32a0c`) |
| **P1b** | On-demand **Refresh** (rate-capped) | ✅ shipped (`6f5b740`) |
| **P1c** | Stream-and-discard (`ephemeral` videos) | ⬜ TODO |
| **P2** | Up-next rabbit hole (watch-page related) | ⬜ TODO |
| **P3** | Flywheel (history-sync) + quality (diversity/freshness/not-interested) | ⬜ TODO |
| **bug** | `continuations=0` — scrapes only ever harvest the first screen | ⬜ **TODO, blocks "endless"** |

## Hard-won lessons (read before touching the scraper)

1. **YouTube's home feed no longer emits `videoRenderer`.** It uses
   `lockupViewModel` (videos) and `shortsLockupViewModel` (Shorts), wrapped in
   `richItemRenderer`. Fixed in `6130a15`; the legacy shape is still parsed for
   other surfaces.
2. **Ads are lockups too.** Sponsored home-feed items are `lockupViewModel`s
   carrying `feedAdMetadataViewModel` (and no `contentType`). They *must* be
   rejected or an ad-free library silently starts downloading ads.
3. **A 0-item scrape is never "ok".** A logged-in home is never empty, so zero
   items means a silently broken parser. `dbc40b2` makes it `needs_attention` and
   logs a histogram of the renderer keys actually seen — that one line is the
   whole drift diagnosis. Check it first.
4. **`continuations=0`.** The scraper scrolls 3× to pull `/youtubei/v1/browse`
   continuations, but captures none, so each scrape only harvests the initial
   page (~23 items). Suspect the scroll fires before the feed is interactive, or
   the `res.json()` handler races navigation. **This caps pool growth and is the
   main thing standing between "a feed" and "endless".** Fix before P3.
5. Settings rows (`recommendedStatus`/`Message`) persist in the DB and are *not*
   recomputed on boot — a stale `ok` can survive a deploy until the next scrape.

## Cookies (already done, but here's how to re-do it when they rotate)

The scraper logs into **your** YouTube with your cookies. Export them from a
**browser private/incognito window** (NOT YouTube's own "Incognito mode", which
signs you out): log in, open a new tab, close the login tab, export with
*Get cookies.txt LOCALLY* (enable the extension for incognito first), then close
the window **without signing out**. That session is never reused, so YouTube
doesn't rotate it out from under MyTube. Upload at *Settings → Recommended feed*.
Look for `[cookies] saved <n>B → /data/cookies.txt` in the logs to confirm it landed.

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
> `RECOMMENDED_FEED_ENABLED=true`, run the built server.
>
> **A real home-page capture already exists on this dev server:**
> `/home/sam/.paseo/uploads/upload_034e435e-cf9d-4bab-88c5-1622c85b4c7e/yt-home.json`
> (1.8 MB `ytInitialData`, captured 2026-07-09). It is what the `lockupViewModel`
> parser was built and validated against. **It is outside the repo and contains
> account context — never commit it**; derive synthesized fixtures from it, as
> `recommended.lockup.test.ts` does. Copy it somewhere durable if you need it to
> survive cleanup. For **P2** you'll want the equivalent capture of a *watch*
> page (`window.ytInitialData` on `/watch?v=…`, plus a `/youtubei/v1/next`
> response) — grab it the same way, from a logged-in browser DevTools console:
> `copy(JSON.stringify(window.ytInitialData))`.

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
