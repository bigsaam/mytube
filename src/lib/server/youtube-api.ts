import { getAccessToken } from './google-auth';

/**
 * Thin YouTube Data API v3 client for the playlist-sync loop. Only the three
 * calls we need: list my playlists, list a playlist's items, delete an item.
 * Auth is a bearer token from google-auth.ts (auto-refreshed).
 */

const BASE = 'https://www.googleapis.com/youtube/v3';

export interface MyPlaylist {
	id: string;
	title: string;
	itemCount: number;
}

export interface PlaylistItem {
	playlistItemId: string; // the id we DELETE to remove from the playlist
	videoId: string;
	title: string;
	channelTitle: string | null;
	channelId: string | null;
	publishedAt: Date | null;
	thumbnailUrl: string | null;
}

async function api(path: string, init: RequestInit = {}): Promise<Response> {
	const token = await getAccessToken();
	return fetch(`${BASE}${path}`, {
		...init,
		headers: { ...init.headers, authorization: `Bearer ${token}` },
		signal: AbortSignal.timeout(30_000)
	});
}

async function apiJson<T>(path: string): Promise<T> {
	const res = await api(path);
	if (!res.ok) {
		const body = await res.text().catch(() => '');
		throw new Error(`YouTube API ${res.status}: ${body.slice(0, 300)}`);
	}
	return (await res.json()) as T;
}

/** List the signed-in user's own playlists (for the queue picker). */
export async function listMyPlaylists(): Promise<MyPlaylist[]> {
	const out: MyPlaylist[] = [];
	let pageToken = '';
	do {
		const data = await apiJson<{
			items?: { id: string; snippet?: { title?: string }; contentDetails?: { itemCount?: number } }[];
			nextPageToken?: string;
		}>(`/playlists?part=snippet,contentDetails&mine=true&maxResults=50&pageToken=${pageToken}`);
		for (const p of data.items ?? []) {
			out.push({ id: p.id, title: p.snippet?.title ?? p.id, itemCount: p.contentDetails?.itemCount ?? 0 });
		}
		pageToken = data.nextPageToken ?? '';
	} while (pageToken);
	return out;
}

interface RawItem {
	id: string;
	snippet?: {
		title?: string;
		videoOwnerChannelTitle?: string;
		videoOwnerChannelId?: string;
		publishedAt?: string;
		thumbnails?: Record<string, { url?: string }>;
		resourceId?: { videoId?: string };
	};
	contentDetails?: { videoId?: string; videoPublishedAt?: string };
}

/** All items in a playlist (paginated), newest first as YouTube returns them. */
export async function listPlaylistItems(playlistId: string): Promise<PlaylistItem[]> {
	const out: PlaylistItem[] = [];
	let pageToken = '';
	do {
		const data = await apiJson<{ items?: RawItem[]; nextPageToken?: string }>(
			`/playlistItems?part=snippet,contentDetails&maxResults=50&playlistId=${encodeURIComponent(playlistId)}&pageToken=${pageToken}`
		);
		for (const it of data.items ?? []) {
			const videoId = it.contentDetails?.videoId ?? it.snippet?.resourceId?.videoId;
			if (!videoId || !/^[A-Za-z0-9_-]{11}$/.test(videoId)) continue;
			const thumbs = it.snippet?.thumbnails ?? {};
			const thumb = thumbs.medium?.url ?? thumbs.high?.url ?? thumbs.default?.url ?? null;
			const published = it.contentDetails?.videoPublishedAt ?? it.snippet?.publishedAt;
			out.push({
				playlistItemId: it.id,
				videoId,
				title: it.snippet?.title ?? videoId,
				channelTitle: it.snippet?.videoOwnerChannelTitle ?? null,
				channelId: it.snippet?.videoOwnerChannelId ?? null,
				publishedAt: published ? new Date(published) : null,
				thumbnailUrl: thumb
			});
		}
		pageToken = data.nextPageToken ?? '';
	} while (pageToken);
	return out;
}

/** Remove an item from its playlist. A 404 means it's already gone — treat as ok. */
export async function deletePlaylistItem(playlistItemId: string): Promise<void> {
	const res = await api(`/playlistItems?id=${encodeURIComponent(playlistItemId)}`, { method: 'DELETE' });
	if (res.ok || res.status === 404) return;
	const body = await res.text().catch(() => '');
	throw new Error(`delete failed ${res.status}: ${body.slice(0, 200)}`);
}
