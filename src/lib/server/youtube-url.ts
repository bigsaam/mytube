import { isVideoId } from './slug';

/**
 * Pure YouTube URL parsing — no network. Handles the shapes people actually
 * paste: watch, youtu.be, shorts, embed, live, and playlist links (including a
 * watch URL that also carries a &list=). Kept dependency-free and unit-tested.
 */

export interface ParsedUrl {
	videoId: string | null;
	playlistId: string | null;
	/** True when the link is *primarily* a playlist (no single video focus). */
	isPlaylistOnly: boolean;
}

const HOSTS = new Set([
	'youtube.com',
	'www.youtube.com',
	'm.youtube.com',
	'music.youtube.com',
	'youtu.be',
	'www.youtu.be'
]);

/** Extract a video id and/or playlist id from an arbitrary user-pasted string. */
export function parseYouTubeUrl(input: string): ParsedUrl {
	const raw = input.trim();

	// Bare 11-char id.
	if (isVideoId(raw)) {
		return { videoId: raw, playlistId: null, isPlaylistOnly: false };
	}

	let url: URL;
	try {
		url = new URL(raw.includes('://') ? raw : `https://${raw}`);
	} catch {
		return { videoId: null, playlistId: null, isPlaylistOnly: false };
	}

	const host = url.hostname.toLowerCase();
	if (!HOSTS.has(host)) {
		return { videoId: null, playlistId: null, isPlaylistOnly: false };
	}

	const playlistId = sanitizePlaylistId(url.searchParams.get('list'));
	let videoId: string | null = null;

	if (host === 'youtu.be' || host === 'www.youtu.be') {
		videoId = pickId(url.pathname.slice(1).split('/')[0]);
	} else {
		const v = url.searchParams.get('v');
		if (v && isVideoId(v)) {
			videoId = v;
		} else {
			// /shorts/ID, /embed/ID, /live/ID, /v/ID
			const segs = url.pathname.split('/').filter(Boolean);
			const kind = segs[0];
			if (['shorts', 'embed', 'live', 'v'].includes(kind)) {
				videoId = pickId(segs[1]);
			}
		}
	}

	// A "Mix" (RD…) or radio list attached to a watch URL isn't a real playlist
	// to expand — treat those as single-video links.
	const realPlaylist = playlistId && !/^(RD|UL|LL|WL)/.test(playlistId) ? playlistId : null;

	return {
		videoId,
		playlistId: realPlaylist,
		isPlaylistOnly: !videoId && !!realPlaylist
	};
}

function pickId(seg: string | undefined): string | null {
	if (!seg) return null;
	const id = seg.split(/[?&#]/)[0];
	return isVideoId(id) ? id : null;
}

function sanitizePlaylistId(id: string | null): string | null {
	if (!id) return null;
	return /^[A-Za-z0-9_-]{10,64}$/.test(id) ? id : null;
}

/** Canonical watch URL for a video id — what we hand to yt-dlp / store. */
export function watchUrl(videoId: string): string {
	return `https://www.youtube.com/watch?v=${videoId}`;
}
