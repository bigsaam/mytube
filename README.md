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

> **Contributing / working on the code?** Read **[AGENTS.md](./AGENTS.md)** — it
> has the architecture, module map, how-to-extend recipes, and the gotchas. The
> HTTP API is in [docs/API.md](./docs/API.md).

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

## Auth

MyTube runs **open (LAN-only)** until you set `AUTH_TOKEN` **or** `AUTH_PASSWORD`
— then auth is enforced everywhere except `/api/health`, `/login`, `/logout`.

- **Browser** → a login page sets an HMAC-signed httpOnly session cookie.
  `AUTH_PASSWORD` is the login password; the `AUTH_TOKEN` also works as a
  break-glass login.
- **Programmatic** (native app, iOS Shortcuts, bookmarklet) → a **bearer token**:
  `Authorization: Bearer <token>`, `X-API-Token: <token>`, or `?token=` on media
  URLs. Use the env `AUTH_TOKEN`, or — better — create **revocable per-device
  tokens** in *Settings → Access & API tokens* (one per device; hashed at rest,
  shown once).

Generate a token with `openssl rand -hex 32`. Full endpoint reference and
client examples: **[docs/API.md](docs/API.md)**.

## Sharing a single video

Open any ready video and click **Share** to mint a public link
(`https://your-mytube/s/<token>`). Anyone with the link can watch **that one
video** — its stream, thumbnail, and subtitles — with no login and **no access
to the rest of your library**. Links are:

- **Scoped** — a share token only ever resolves to its one video, and is only
  accepted on the `/s/…` routes (never as a normal bearer token).
- **Expiring** — default 30 days; choose 1 / 7 / 30 days or *never* at creation.
- **Revocable** — kill a link instantly from the video's Share panel or from
  **Settings → Shared links** (which lists every active link).

Tokens are stored hashed; the full link is shown once at creation. For a friend
to reach the link, MyTube must be reachable at your public `ORIGIN` (see below).

## Stats, comments & the playlist queue

- **Engagement stats** — view/like/comment counts are snapshotted from each
  download's `info.json` and shown on the watch page (and share pages). They're
  a *point-in-time* capture ("… at download"), not live.
- **Comments** — on by default (*Settings → Downloads*), MyTube fetches the top
  **20 comment threads with up to 5 replies each** into the library and renders
  them under the video. Turn it off to speed up downloads.
- **Playlist as a queue** — with playlist sync on, MyTube can treat the synced
  playlist as a pure download queue: items are removed from the YouTube playlist
  **once downloaded** (not once watched), and watched playlist videos are
  auto-cleaned on the next sweep unless you mark them **Keep**. Both are toggles
  in *Settings → Watched & cleanup*.

## Exposing MyTube publicly

MyTube is single-user and API-first, so the recommended posture is: **let a
tunnel/proxy handle TLS, and let MyTube's own token auth handle identity.** Don't
put an interactive SSO gate (Cloudflare Access, Authentik-protect-everything) in
front of the whole app — it breaks the native-app / Shortcuts / `AVPlayer` paths,
which can't do a browser login. If you want SSO on the browser UI specifically,
run it in *hybrid* mode with `/api/*` bypassed so bearer clients pass through.

Whatever fronts it, two settings are mandatory:

```bash
ORIGIN=https://mytube.example.com   # your public HTTPS URL — fixes CSRF, the
                                    # Secure cookie, and the OAuth redirect URI
AUTH_TOKEN=<openssl rand -hex 32>   # (or AUTH_PASSWORD) — turns auth on
```

Getting `ORIGIN` wrong is the #1 gotcha: with it unset behind a proxy, SvelteKit's
CSRF check rejects every form action (add channel, save settings, login) with a
403.

### Cloudflare Tunnel (recommended)

The tunnel terminates TLS and hides your origin; MyTube does the auth. No
Cloudflare Access needed.

```bash
# .env
ORIGIN=https://mytube.example.com
AUTH_TOKEN=<openssl rand -hex 32>
AUTH_COOKIE_SECURE=true            # (auto-on from an https ORIGIN)
ADDRESS_HEADER=CF-Connecting-IP    # so login rate-limiting sees real client IPs
BIND_ADDR=127.0.0.1                # default — don't expose the port on the LAN
```

`docker compose up -d` now binds `127.0.0.1:3000` only. Point the tunnel at it:

```yaml
# ~/.cloudflared/config.yml  (cloudflared on the host)
ingress:
  - hostname: mytube.example.com
    service: http://localhost:3000
  - service: http_status:404
```

If `cloudflared` runs as a container in this compose project instead, drop the
published port entirely and use the service name: `service: http://mytube:3000`.

Notes: video range-streaming and the download-progress SSE stream both proxy
fine through Cloudflare (heartbeats + `no-transform` keep SSE alive). Authed
media responses are sent `Cache-Control: private` so the edge can't cache and
serve them without auth. Optionally add a Cloudflare WAF rate-limit rule on
`/login` for cheap defense-in-depth.

> **Direct LAN access instead?** Set `BIND_ADDR=0.0.0.0` to publish the port on
> your network, and set `ORIGIN` to `http://<lan-ip>:3000`.

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

## YouTube playlist sync — the phone loop

The headline workflow: **add a video to a playlist on your phone → MyTube grabs
it → it leaves the playlist (so the playlist stays a clean to-download queue) →
you watch it here.** No app needed on the phone; just the normal YouTube Save
button.

Because YouTube's built-in **Watch Later** is not reachable by any API (Google
deprecated that in 2016), MyTube syncs a **normal playlist you create** — e.g.
"MyTube Queue" — via the official **YouTube Data API v3** (robust, no scraping).

### One-time setup

1. In [Google Cloud Console](https://console.cloud.google.com/apis/credentials):
   create a project → enable **YouTube Data API v3** → create an **OAuth client
   ID** (type: *Web application*) → add the redirect URI shown on the MyTube page
   (`<ORIGIN>/api/google/callback`).
2. In MyTube → **Settings → YouTube playlist sync**: paste the client ID/secret,
   click **Connect YouTube account**, approve, then pick your queue playlist.

> Make sure `ORIGIN` in `.env` matches how you reach MyTube — the OAuth redirect
> URI is built from it and must match Google exactly.

### The loop

- MyTube polls the playlist ~every 5 min; new videos download and land in
  **Watch Later**. (Thumbnails, chapters, description all populate.)
- Watch here — **sponsor/intro/outro segments are cut from the file on download**
  by default (yt-dlp `--sponsorblock-remove`; switch to in-player skipping in
  Settings), and there are no ads (it's a local file).
- MyTube calls `playlistItems.delete` to remove it from the playlist **once
  it's downloaded** by default (the playlist acts as a pure queue), or *once
  watched* if you prefer — toggle in *Settings → Watched & cleanup*. Failures
  retry and never block local playback.
- Watched playlist videos are auto-cleaned from disk on the next sweep unless you
  mark them **Keep** (also a toggle there).

OAuth client secret + refresh token live in a `0600` file under `/data`, never
in the DB and never sent to the browser.

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

No transcoding/HLS and no **multi-user** accounts — auth is single-user
(token / password / session, plus scoped per-video share links). Write-backs to
YouTube are limited to the optional watched-history ping and playlist-queue
removal.

## License

[MIT](./LICENSE) © 2026 Sam Monga. Not affiliated with YouTube or Google.
