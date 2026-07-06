# MyTube

A self-hosted personal YouTube frontend for your homelab. Videos you care about
are downloaded locally with **yt-dlp** and watched through a clean, fast,
keyboard-friendly UI — no algorithmic feed, no view counts, no engagement junk.

Two ways videos get in:

1. **Channel subscriptions → Feed.** Poll each channel's public RSS, surface new
   uploads, and pick what to **Grab**.
2. **Watch Later.** Paste any YouTube URL (bookmarklet / iOS shortcut friendly)
   to queue a download.

Plus an optional, flag-gated **Recommended feed** scraped from your own
logged-in YouTube homepage via Playwright.

> **Status:** built in phases (see [Build phases](#build-phases)). Each phase is
> a self-contained commit.

---

## Stack

- **SvelteKit** (Svelte 5, TypeScript) — UI + API in one Node process
- **SQLite** via **Drizzle ORM** (single file, trivial to back up)
- **yt-dlp** + **ffmpeg** subprocesses for downloading / remuxing
- **Tailwind CSS**, dark by default
- In-process, **SQLite-backed job queue** — survives restarts, no Redis
- Optional **Playwright** (Chromium) for the recommended feed

## Quick start (Docker)

```bash
cp .env.example .env      # tweak if you like; defaults are sane for LAN use
docker compose up -d --build
# open http://localhost:3000
```

The default image ships **no browser**. To enable the recommended-feed module,
build the Chromium target and flip the flag (see [Recommended feed](#recommended-feed-optional)).

### Volume layout

Two volumes, mounted in `docker-compose.yml`:

| Container path | Host (compose) | Contents                                            |
| -------------- | -------------- | --------------------------------------------------- |
| `/data`        | `./data`       | SQLite DB, config, `cookies.txt`, browser profile   |
| `/media`       | `./media`      | Downloaded videos, thumbnails, subtitles, info JSON |

Media is laid out as:

```
/media/{channel_slug}/{video_id}/
    video.mp4
    thumb.jpg
    en.vtt
    info.json
```

`{video_id}` (YouTube's 11-char id) is the canonical key everywhere; the
channel slug is a sanitized, filesystem-safe convenience only.

Back up by copying `/data` (the DB) — and `/media` if you want the files.

## Local development

```bash
pnpm install
pnpm run db:generate      # regenerate migration SQL after schema changes
pnpm dev                  # http://localhost:5173
```

Requires `yt-dlp` and `ffmpeg` on your PATH for the download pipeline. The DB
migrates automatically on first boot.

### Handy scripts

| Command             | Purpose                              |
| ------------------- | ------------------------------------ |
| `pnpm dev`          | Dev server                           |
| `pnpm build`        | Production build (`build/index.js`)  |
| `pnpm start`        | Run the production build             |
| `pnpm check`        | Type-check                           |
| `pnpm test`         | Unit tests (Vitest)                  |
| `pnpm db:generate`  | Generate Drizzle migrations          |

## Configuration

Behavior split in two:

- **Environment** (`.env`) — deploy-time wiring: ports, paths, feature flags,
  concurrency. See [`.env.example`](.env.example).
- **Settings page** — runtime-tunable behavior: download quality, cleanup
  policy, poll intervals, SponsorBlock categories, recommended-feed filters.
  Stored in the DB; survives restarts.

## Quick-add & bookmarklet

Fling any YouTube URL in from anywhere. The endpoint queues a download and
(optionally) adds to Watch Later.

```bash
# JSON body
curl -X POST http://HOST:3000/api/add \
  -H 'content-type: application/json' \
  -d '{"url":"https://youtu.be/dQw4w9WgXcQ","addToWatchLater":true}'

# Querystring (handy for shortcuts / GET)
curl 'http://HOST:3000/api/add?url=https://youtu.be/dQw4w9WgXcQ&watchLater=1'
```

Responses:

- **Single video** → `{ "queued": 1, "videoId": "…", "message": "…" }`
- **Playlist link** → `{ "requiresConfirmation": true, "count": N, "entries": [...] }`.
  Confirm by POSTing `{ "videoIds": ["…", "…"] }` (the top-bar box does this for you).

### Bookmarklet

Drag a bookmark with this URL (replace `HOST`), then click it on any YouTube
watch page to grab the video:

```js
javascript:(()=>{fetch('http://HOST:3000/api/add?url='+encodeURIComponent(location.href)).then(r=>r.json()).then(d=>alert(d.message||('Queued '+(d.queued||0)))).catch(e=>alert('MyTube: '+e))})();
```

### iOS Shortcut

Create a Shortcut: **Get Current URL from Safari → URL-encode → Get Contents of**
`http://HOST:3000/api/add?url=[encoded]` (Method: GET). Add to the Share Sheet to
fling videos in from anywhere on iOS.

## Recommended feed (optional)

Off by default. Two independent, cookie-authenticated integrations, each behind
a flag. When the flags are off, no browser is installed or launched and nothing
writes back to YouTube.

### 1. Recommended feed — `RECOMMENDED_FEED_ENABLED=true`

Scrapes your own logged-in YouTube homepage with Playwright (Chromium):

1. Build the browser image: `docker build --target runtime-chromium -t mytube:chromium .`
   (or set `target: runtime-chromium` in compose). Chromium adds ~450 MB.
2. Export `cookies.txt` with the **Get cookies.txt LOCALLY** extension while
   logged into YouTube, and upload it under **Settings → Recommended feed**.

It seeds a **persistent** browser profile (`/data/browser-profile`) from those
cookies, polls 2–4×/day (jittered, one session, images/media/fonts blocked),
pulls `ytInitialData` + `/youtubei/v1/browse` continuations (no DOM scraping),
and drops normalized items into the same feed with `source=recommended`
(deduped against subscriptions + the library; Shorts/mixes/live filtered by
default). All JSON parsing is isolated in `src/lib/server/recommended.ts` with
fixture tests. On a consent wall / captcha / logged-out page it **pauses and
shows a “needs attention” banner** in Settings rather than retrying.

The same `cookies.txt` is passed to yt-dlp (`--cookies`) so members-only /
age-gated videos download too.

### 2. Watch-history write-back — `HISTORY_SYNC_ENABLED=true`

When you mark a video watched, MyTube tells YouTube it was watched so your
recommendations keep learning. It shells out to
`yt-dlp --simulate --skip-download --mark-watched --cookies <file> <url>`
(yt-dlp pings the real `videostats` tracking URLs). Jobs are jittered
(1–15 min), retried twice, and failures never block the local watched flow.
Per-video opt-out (“local-only”) lives in the player’s action row. Dismissing a
feed item never syncs anything.

## Build phases

1. **Scaffold + schema** ✅ — SvelteKit + Drizzle + Docker; core tables; sidebar shell.
2. **Download pipeline + player** ✅ — yt-dlp wrapper, queue + worker, range streaming.
3. **Full player** ✅ — progress, chapters, SponsorBlock, subs, shortcuts.
4. **Channels + feed** ✅ — RSS polling, feed actions, Takeout import.
5. **Lifecycle + polish** ✅ — watched auto-mark, cleanup, storage, SSE downloads.
6. **Recommended feed + history sync** ✅ — Playwright module, cookies, `--mark-watched`.

## Non-goals (v1)

No transcoding/HLS, no auth/multi-user, no comments. The only write-back to
YouTube is the optional watched-history ping.
