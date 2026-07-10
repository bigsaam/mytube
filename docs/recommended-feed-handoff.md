# Recommended feed — build handoff

Status of the "Discover / recommended feed" flywheel and what's left. Pick this
up cold in a new session. Last updated after **P3**. **All phases shipped; the
roadmap is closed.** The channel-diversity cap and min-duration filter were
considered and deliberately dropped — see P3.

## TL;DR

**The feed is LIVE and working end-to-end on prod.** Cookie upload → persistent
Chromium profile → logged-in YouTube → `lockupViewModel` parse → ads rejected →
pool → `/discover`.

Two sources fill the pool: the **home feed** (scheduled 2–4×/day plus manual
Refresh; ~100–145 items per scrape across 4–6 continuations) and the **up-next
rail** of whatever you watch (~59 items, rate-capped per video and per hour).
"Not interested" blocks a channel outright, untouched items expire after 14 days,
and "Watch now" streams a video then discards it once watched.

| Phase | What | Status |
|---|---|---|
| **P0** | Enable it on prod (Chromium image, flag, cookies) | ✅ **done & verified** |
| **P1a** | Dedicated `/discover` surface + pool table | ✅ shipped (`4e32a0c`) |
| **P1b** | On-demand **Refresh** (rate-capped) | ✅ shipped (`6f5b740`) |
| **P1c** | Stream-and-discard (`ephemeral` videos) | ✅ **shipped** |
| **P2** | Up-next rabbit hole (watch-page related) | ✅ **shipped & verified** |
| **P3** | Flywheel (history-sync nudge) + quality (not-interested / expiry) | ✅ **shipped** |
| **bug** | `continuations=0` — scrapes only ever harvest the first screen | ✅ **fixed & verified** |

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
4. **Continuations need a *bottom* scroll, after the feed renders.** (Fixed; was
   the `continuations=0` bug.) YouTube fetches `/youtubei/v1/browse` when its
   continuation sentinel — which sits at the very bottom — enters the viewport.
   The old loop scrolled a fixed `innerHeight * 2` right after `domcontentloaded`,
   before the page was even tall enough to scroll, and floated `res.json()` in an
   async `response` handler that could still be in flight at `context.close()`.
   `harvestContinuations` now waits for the document to overflow the viewport,
   then per round arms a `waitForResponse` on `/browse`, scrolls to the true
   bottom, and breaks early if nothing lands. Verified live: **1 continuation /
   46 items → 6 / 145**, same cookies and profile.
   - Gate on *scrollability*, not on `ytd-rich-item-renderer` or any other
     YouTube tag name — same drift risk as the parser (lesson 1).
   - `HOME_SCROLL_ROUNDS = 5` is now the **binding limit** (every round lands a
     continuation; the early-break never fires). Raise it for a deeper pool,
     traded against politeness. It is no longer a bug.
   - **Logged-out YouTube serves no home feed at all** — `scrollHeight ==
     innerHeight`, nothing to scroll. Any scroll/continuation work is
     unverifiable without cookies; a logged-out probe will report 0 and tell you
     nothing.
5. **A continuation request is not just "the endpoint".** `/youtubei/v1/browse`
   and `/youtubei/v1/next` are *also* how the page loads itself. Those page-load
   requests carry **no `continuation` token in the POST body**; the lazy-loaded
   ones do. Waiting on the bare URL matches the page-load request instantly,
   reports "got a continuation", and harvests nothing — and it will mask every
   other fix you try, because the scrape *looks* successful. `harvestContinuations`
   matches on `postData()` containing `"continuation"`. This cost hours; don't
   undo it.
6. **On a watch page, don't wait for `ytInitialData` to update.** YouTube merges
   `/next` back into it slowly, partially, and sometimes not at all. Worse, raw
   `lockupViewModel` counts grow *before* the items become parseable, so every
   "wait until it settles" heuristic returns early with half the rail. Parse the
   `/next` **response bodies** directly, exactly as the home scrape parses
   `/browse`.
7. **A watch page briefly collapses to viewport height around the `load` event**
   (`scrollHeight == innerHeight == 900`). A scroll issued in that window travels
   ~50px and triggers nothing. And once parked at the bottom, re-setting
   `scrollTop = scrollHeight` moves nothing and fires no intersection — retries
   must "jiggle" up first to re-arm the sentinel.
8. Settings rows (`recommendedStatus`/`Message`) persist in the DB and are *not*
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
> into `./data/cookies.txt` (gitignored via `/data`), `pnpm exec playwright
> install chromium`, set `RECOMMENDED_FEED_ENABLED=true`, run the built server.
>
> To drive one scrape without the server, put a scratch `*.test.ts` in
> `src/lib/server/` that calls `runMigrations()` then `runRecommendedScrape()`,
> and run it with `npx vitest run <file>`. Vitest is the easy path because
> `config.ts` imports `$env/dynamic/private`, which only resolves under the
> bundler — for the same reason **`pnpm db:migrate` fails outside the build**
> (`Cannot find package '$lib'`), so migrate from that scratch test too. Delete
> the scratch file afterwards. The `[recommended] scrape: … continuations=N` log
> line is the pass/fail signal.
>
> **A real home-page capture already exists on this dev server:**
> `/home/sam/.paseo/uploads/upload_034e435e-cf9d-4bab-88c5-1622c85b4c7e/yt-home.json`
> (1.8 MB `ytInitialData`, captured 2026-07-09). It is what the `lockupViewModel`
> parser was built and validated against. **It is outside the repo and contains
> account context — never commit it**; derive synthesized fixtures from it, as
> `recommended.lockup.test.ts` does. Copy it somewhere durable if you need it to
> survive cleanup.
>
> A **watch-page capture** now also exists on this dev server, from the same
> logged-in session: `~/mytube-fixtures/yt-watch.json` (2.8 MB `ytInitialData`)
> and `~/mytube-fixtures/yt-watch-next.json` (the `/youtubei/v1/next` responses),
> captured 2026-07-09 for `-YRXMgKMlWY`. Same rules: **outside the repo, account
> context, never commit**. `recommended.upnext.test.ts` uses synthesized fixtures
> derived from them.

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
| `src/lib/server/recommended-scraper.ts` | Playwright driver (dynamic import). Home + up-next scrapes, continuation harvesting, cookie seeding, wall detection. |
| `src/lib/server/discover.ts` | The pool: `ingestRecommended`, `listRecommendations` (id-cursor), grab/dismiss, `requestManualScrape` + `requestUpnextScrape` (rate caps). |
| `src/lib/server/db/schema.ts` | `recommendations` table (`source`/`sourceVideoId`/`rank`/`status`). |
| `src/routes/discover/*` | The surface: grid, Load more, Refresh, actions. |
| `src/routes/api/recommended/*` | `GET` (paginate), `POST` (actions), `POST /refresh`. |
| `src/lib/server/scheduler.ts` | Schedules `recommended_scrape` 2–4×/day. |
| `src/lib/server/job-handlers.ts` | Registers `recommended_scrape` handler + hooks. |

Flow: `scheduler`/Refresh → `recommended_scrape` job → `runRecommendedScrape`
(Playwright) → `extractRecommended` (parse) → `ingestRecommended` (pool, deduped
vs library + pool) → `/discover`.

## Remaining work (build-ready notes)

### P1c — stream-and-discard ✅ shipped
"Watch now" on a Discover card grabs the video as `ephemeral` and navigates to
`/watch/<id>`; the cleanup sweep prunes it once watched.

- Migration `0008_ordinary_invisible_woman.sql` adds `videos.ephemeral`.
- `ephemeral` is set **only on insert** — a video already in your library was
  chosen deliberately, so "Watch now" must never mark it disposable.
- The sweep's ephemeral pass is **unconditional**: it prunes even under
  `keep_forever`, since an ephemeral video was never meant to be kept.
- **Keep (pin) clears `ephemeral` outright**, rather than just exempting it.
  Otherwise un-pinning later would silently re-arm the sweep and delete
  something the user explicitly kept.
- Pins are guarded twice (the sweep query *and* `deleteFiles`). Deliberate —
  `lifecycle.ephemeral.test.ts` documents that a mutation to either layer alone
  still passes, so don't "simplify" one away.
- `FeedCard` takes an optional `onWatchNow`; `/feed` omits it, so the button
  only appears on Discover, where items are actually disposable.

### P2 — up-next rabbit hole ✅ shipped
Watching a video now seeds more recommendations. `runUpnextScrape(videoId)` →
`upnext_scrape` job → fired from `setWatchedHook`. Verified live: **59 related
items, 5 continuations** off one watch page.

What the original plan got wrong, for the record:
- **No `compactVideoRenderer` anywhere.** The watch page is 100% `lockupViewModel`
  — the *same* shape as the home feed. **The parser needed zero changes.** Don't
  "extend the parser" for a new surface until you've confirmed it's actually new.
- Watch-page lockups carry **no `commandRuns`** — but they DO expose the channel
  browseId on the avatar (`…image.decoratedAvatarViewModel`). The parser reads
  both sources, so the blocklist works on either surface with no extra requests.
- Ads reach the rail via `adSlotRenderer` nesting a lockup with a real
  `contentId`. It's rejected by `feedAdMetadataViewModel` alone — a lockup with
  no `contentType` is otherwise *accepted*. That marker is load-bearing;
  `recommended.upnext.test.ts` pins it.

The per-card **"More like this"** button shipped with P3 and calls
`requestUpnextScrape` on demand (rate-capped server-side).

Rate caps (`discover.ts`): per-video (`upnext:<id>` dedupe key + skip videos that
already have `upnext` rows naming them as source) and global
(`UPNEXT_MAX_PER_HOUR = 6`) — a binge would otherwise fire one scrape per video.

### P3 — flywheel + quality ✅ shipped (partially)

**Shipped**
- **"Not interested"** (`notInterestedRecommendation`): hides the video, blocks
  the channel, and sweeps that channel's other `new` rows out of the pool.
- **Channel blocklist** (`blocked_channels`, migration `0009`): honored by
  `ingestRecommended` before anything reaches the pool.
- **Stale expiry** (`expireStaleRecommendations`): deletes untouched `new` rows
  older than `recommendedExpiryDays` (default 14, 0 disables). Runs on the
  `cleanup` job. **Only `new` rows** — a `downloaded`/`dismissed`/
  `not_interested` row records a user decision and must survive, or the next
  scrape re-ingests what they rejected.
- **"More like this"** per-card button → `requestUpnextScrape` (the P2 leftover).
- **History-sync nudge** in Settings → Recommended feed, shown when the feed is
  on and `HISTORY_SYNC_ENABLED` is off. It's an env var, so the nudge explains
  where to set it rather than pretending there's a toggle. It also states plainly
  that a history ping earns the creator nothing — it only tunes your feed.

**Dropped, not deferred** (decided 2026-07-10): the channel-diversity cap in
`listRecommendations` ranking, and a min-duration filter setting. Neither is
pending work — don't resurrect them as TODOs. "Not interested" already handles
a channel that dominates the pool, and it does so on the user's judgement rather
than a heuristic. Revisit only if the pool actually feels lopsided in practice.

#### The channelId question — answered, and it cost a live bug

The plan assumed watch-page items had no channelId and that we'd need a network
backfill. **Wrong.** Watch-page lockups DO carry it, on the channel avatar
(`lockupMetadataViewModel.image.decoratedAvatarViewModel…browseEndpoint.browseId`),
just not on `commandRuns` where home-feed lockups keep it. The parser now reads
both. **Zero extra requests.** Coverage with production filters: **39/40** on a
watch page, **21/22** on home. The gap is mostly Shorts, which are filtered out.

So the blocklist keys on `channelId`, with a case/whitespace-insensitive
`channelName` fallback for the stragglers. Names are display strings — they
change and collide — so name-blocking is best-effort by design.

**The bug this caused:** rows ingested *before* the avatar fix have a null
`channelId`. Sweeping the pool on channelId alone left 8 of one channel's 20
cards sitting on Discover after the user blocked it. The sweep now matches
id **OR** name, mirroring `isBlocked`. Verified against the real 398-row pool:
0 left behind, 0 reappeared after a live re-scrape. Regression test:
`discover.p3.test.ts` → "sweeps siblings that predate channelId extraction".

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
