# MyTube API

A small HTTP API that the web UI and (future) native apps both use. It's stable
enough to build a client against; anything not listed here is an internal web-UI
form action and may change.

Base URL is your MyTube origin, e.g. `https://mytube.example.com`.

## Authentication

Auth is enforced whenever `AUTH_TOKEN` or `AUTH_PASSWORD` is set (see the README).
With neither set, MyTube runs open in LAN-only mode and no credentials are needed.

Credentials, in order of precedence:

| Method | How | Best for |
| --- | --- | --- |
| `Authorization: Bearer <token>` | HTTP header | native apps, scripts |
| `X-API-Token: <token>` | HTTP header | scripts |
| `?token=<token>` | query string | media URLs, bookmarklets (leaks into logs — least preferred) |
| `mt_session` cookie | set by `/login` | the browser UI |

`<token>` is either the master `AUTH_TOKEN` or a **device token** you create in
**Settings → Access & API tokens** (revocable, recommended — issue one per
device so a lost phone doesn't force a full rotation).

Unauthenticated requests get `401 {"error":"unauthorized"}` for `/api/*`, or a
303 redirect to `/login` for pages.

```bash
export MT=https://mytube.example.com
export TOK=mt_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
curl -H "Authorization: Bearer $TOK" "$MT/api/health"
```

## Endpoints

### `GET /api/health` — liveness (public)
Always reachable without auth (used by the container healthcheck).
```json
{ "ok": true, "service": "mytube" }
```

### `POST /api/add` — queue a download
The core "grab this" call. Accepts JSON, form-encoded, or query params.

```bash
# single video
curl -X POST "$MT/api/add" -H "Authorization: Bearer $TOK" \
  -H 'content-type: application/json' \
  -d '{"url":"https://youtu.be/dQw4w9WgXcQ","addToWatchLater":true}'
```
Response (single video):
```json
{ "queued": 1, "status": "queued", "videoId": "dQw4w9WgXcQ",
  "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ", "message": "Queued for download" }
```
`status` is one of `queued` | `exists` | `in_progress`.

Playlist link → returns items for a confirmation step (nothing is queued yet):
```json
{ "requiresConfirmation": true, "playlistId": "PL…", "count": 12,
  "entries": [ { "videoId": "…", "title": "…", "channelName": "…", "durationSeconds": 610 } ] }
```
Confirm by posting the ids you want:
```bash
curl -X POST "$MT/api/add" -H "Authorization: Bearer $TOK" \
  -H 'content-type: application/json' \
  -d '{"videoIds":["id1","id2"],"addToWatchLater":false}'
```
`GET /api/add?url=<encoded>&watchLater=1` is the convenience form for bookmarklets
and iOS Shortcuts.

### `POST /api/progress` — save playback position
Send every few seconds while playing. Crossing the auto-watched threshold
(default 90%) marks the video watched (which removes it from Watch Later and,
if configured, from the synced YouTube playlist).
```bash
curl -X POST "$MT/api/progress" -H "Authorization: Bearer $TOK" \
  -H 'content-type: application/json' \
  -d '{"videoId":"dQw4w9WgXcQ","position":123.4,"duration":610}'
# → { "ok": true, "watched": false }
```

### `POST /api/feed` — act on a feed item
```bash
curl -X POST "$MT/api/feed" -H "Authorization: Bearer $TOK" \
  -H 'content-type: application/json' -d '{"id":42,"action":"grab"}'
```
`action`: `grab` | `watchLater` | `dismiss`. → `{ "ok": true }`

### `POST /api/watch-later/reorder` — reorder the queue
```json
{ "order": ["videoIdA", "videoIdB", "videoIdC"] }
```

### `GET /api/stream/{videoId}` — the video file
Serves `video/mp4` with full **HTTP range** support (`206 Partial Content`,
suffix ranges, `416` on unsatisfiable). This is what an `AVPlayer` / `<video>`
points at. Send auth as a header (native) — the browser sends the cookie
automatically; `?token=` works where headers can't be set.
```bash
curl -H "Authorization: Bearer $TOK" -H 'Range: bytes=0-1023' "$MT/api/stream/dQw4w9WgXcQ"
```

### `GET /api/thumb/{videoId}` — thumbnail (jpg)
### `GET /api/subs/{videoId}` — subtitles (WebVTT)

### `GET /api/downloads/events` — live download progress (SSE)
`text/event-stream`; each `data:` frame is the full downloads array (id, videoId,
title, status, progress 0–1, speed, eta, stage, error). Emits on connect and on
every change.
```
data: [{"id":1,"videoId":"…","status":"active","progress":0.42,"stage":"download",…}]
```

### OAuth (browser only)
`GET /api/google/connect` → Google consent. `GET /api/google/callback` → token
exchange. Used by **Settings → YouTube playlist sync**; not for programmatic use.

## Notes for a native client

- **Playback**: point the player at `/api/stream/{id}` and send the bearer
  header. Range requests already work, so scrubbing is native.
- **Resume / watched**: POST `/api/progress` on a timer and on pause/background;
  the ≥90% rule marks watched server-side and drives playlist removal.
- **Add flow**: a Share Sheet extension can POST straight to `/api/add` — that
  bypasses the YouTube-playlist round-trip entirely.
- **Auth**: create a device token per install; store it in the Keychain. Revoke
  from Settings if the device is lost.
- **Discovery**: `/api/health` for reachability; there's no CORS allowance for
  browsers on other origins, but a native app isn't subject to CORS.
