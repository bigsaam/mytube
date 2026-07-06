import { eq } from 'drizzle-orm';
import { db } from './db';
import { videos } from './db/schema';
import { getSettings } from './settings';
import { authStatus } from './google-auth';
import { listPlaylistItems, deletePlaylistItem } from './youtube-api';
import { enqueueDownload } from './downloads';
import { enqueueJob } from './jobs';

/**
 * YouTube playlist sync loop (Data API):
 *   input  — poll a dedicated playlist, auto-grab new items, remember each
 *            item's playlistItemId for later removal
 *   output — when a video is watched, DELETE it from the playlist
 *
 * The literal "Watch Later" (WL) playlist is NOT accessible via the Data API,
 * so this works against a normal user playlist chosen in Settings.
 */

export function playlistSyncActive(): boolean {
	const s = getSettings();
	return s.playlistSyncEnabled && !!s.syncPlaylistId && authStatus().connected;
}

/** Poll the configured playlist and grab anything new. Returns count grabbed. */
export async function syncPlaylist(): Promise<number> {
	const s = getSettings();
	if (!playlistSyncActive() || !s.syncPlaylistId) return 0;

	const items = await listPlaylistItems(s.syncPlaylistId);
	let grabbed = 0;
	for (const it of items) {
		const existing = db
			.select({ videoId: videos.videoId, playlistItemId: videos.playlistItemId })
			.from(videos)
			.where(eq(videos.videoId, it.videoId))
			.get();

		// Already grabbed and already linked → nothing to do.
		if (existing?.playlistItemId === it.playlistItemId) continue;

		const res = enqueueDownload({
			videoId: it.videoId,
			title: it.title,
			channelId: it.channelId,
			channelName: it.channelTitle,
			thumbnailUrl: it.thumbnailUrl,
			// Show it in the Watch Later queue as "to watch".
			addToWatchLater: true,
			sourcePlaylistId: s.syncPlaylistId,
			playlistItemId: it.playlistItemId
		});
		if (res.status === 'queued') grabbed++;
	}
	return grabbed;
}

/** Called from the watched hook — queue a playlist removal if this video came
 * from the synced playlist and sync is active. */
export function enqueuePlaylistRemove(videoId: string): void {
	if (!playlistSyncActive()) return;
	const row = db
		.select({ playlistItemId: videos.playlistItemId })
		.from(videos)
		.where(eq(videos.videoId, videoId))
		.get();
	if (!row?.playlistItemId) return;
	enqueueJob('playlist_remove', { videoId }, { dedupeKey: `plrm:${videoId}`, maxAttempts: 3 });
}

/**
 * Remove a watched video from its source playlist. Called by the
 * playlist_remove job. Clears the local linkage afterward so it never re-fires.
 */
export async function removeFromPlaylist(videoId: string): Promise<void> {
	const row = db
		.select({ playlistItemId: videos.playlistItemId })
		.from(videos)
		.where(eq(videos.videoId, videoId))
		.get();
	if (!row?.playlistItemId) return;
	if (!authStatus().connected) return; // disconnected — leave linkage for later

	await deletePlaylistItem(row.playlistItemId);
	db.update(videos).set({ playlistItemId: null }).where(eq(videos.videoId, videoId)).run();
}
