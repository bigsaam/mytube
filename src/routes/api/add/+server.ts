import { json, error } from '@sveltejs/kit';
import { parseYouTubeUrl, watchUrl } from '$lib/server/youtube-url';
import { enqueueDownload } from '$lib/server/downloads';
import { probePlaylist } from '$lib/server/ytdlp';
import { isVideoId } from '$lib/server/slug';
import type { RequestHandler } from './$types';

/**
 * Quick-add endpoint. Powers the top-bar box, the bookmarklet, and iOS
 * shortcuts. Accepts:
 *   POST { url, addToWatchLater? }             single video → queued
 *   POST { url }  (playlist link)              → { requiresConfirmation, entries }
 *   POST { videoIds: [...], addToWatchLater? } confirmed playlist enqueue
 *   GET  /api/add?url=...&watchLater=1         bookmarklet convenience
 */

interface AddBody {
	url?: string;
	videoIds?: string[];
	addToWatchLater?: boolean;
}

async function add(body: AddBody) {
	const wl = !!body.addToWatchLater;

	// Confirmed batch (e.g. after playlist expansion).
	if (Array.isArray(body.videoIds) && body.videoIds.length) {
		const ids = body.videoIds.filter(isVideoId).slice(0, 500);
		let queued = 0;
		for (const videoId of ids) {
			const r = enqueueDownload({ videoId, addToWatchLater: wl });
			if (r.status === 'queued') queued++;
		}
		return json({ queued, total: ids.length, message: `Queued ${queued} video(s)` });
	}

	const url = (body.url ?? '').trim();
	if (!url) error(400, 'Missing url');

	const parsed = parseYouTubeUrl(url);

	// Playlist-only link → expand and ask for confirmation before queueing.
	if (!parsed.videoId && parsed.playlistId) {
		const entries = await probePlaylist(`https://www.youtube.com/playlist?list=${parsed.playlistId}`);
		if (!entries.length) error(422, 'Could not read that playlist');
		return json({
			requiresConfirmation: true,
			playlistId: parsed.playlistId,
			count: entries.length,
			entries: entries.map((e) => ({
				videoId: e.videoId,
				title: e.title,
				channelName: e.channelName,
				durationSeconds: e.durationSeconds
			}))
		});
	}

	if (!parsed.videoId) error(422, "That doesn't look like a YouTube video or playlist link");

	const result = enqueueDownload({ videoId: parsed.videoId, addToWatchLater: wl });
	const messages: Record<string, string> = {
		queued: wl ? 'Added to Watch Later — downloading' : 'Queued for download',
		exists: 'Already in your library',
		in_progress: 'Already downloading'
	};
	return json({
		queued: result.status === 'queued' ? 1 : 0,
		status: result.status,
		videoId: result.videoId,
		url: watchUrl(result.videoId),
		message: messages[result.status]
	});
}

export const POST: RequestHandler = async ({ request, url }) => {
	let body: AddBody = {};
	const ctype = request.headers.get('content-type') ?? '';
	if (ctype.includes('application/json')) {
		body = (await request.json().catch(() => ({}))) as AddBody;
	} else if (ctype.includes('application/x-www-form-urlencoded')) {
		const form = await request.formData();
		body = { url: String(form.get('url') ?? ''), addToWatchLater: form.get('watchLater') != null };
	}
	// Query params override / supplement (bookmarklet may POST with ?url=).
	if (url.searchParams.has('url')) body.url = url.searchParams.get('url')!;
	if (url.searchParams.has('watchLater')) body.addToWatchLater = true;
	return add(body);
};

// GET convenience for bookmarklets / shortcuts.
export const GET: RequestHandler = async ({ url }) => {
	const u = url.searchParams.get('url');
	if (!u) error(400, 'Missing url');
	return add({ url: u, addToWatchLater: url.searchParams.has('watchLater') });
};
