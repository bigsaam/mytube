import { registerJobHandler, pruneJobs } from './jobs';
import { pollChannel, fillFeedItemDuration, expireOldFeedItems } from './feed';
import { runCleanupSweep, setWatchedHook } from './lifecycle';
import { runRecommendedScrape } from './recommended-scraper';
import { enqueueHistorySync, runHistorySync } from './history-sync';
import { syncPlaylist, removeFromPlaylist, enqueuePlaylistRemove } from './playlist-sync';
import { setDownloadedHook } from './downloads';
import { backfillVideo } from './backfill';
import { getSettings } from './settings';

/**
 * Wires job types to their handlers + registers cross-module hooks. Called once
 * at worker startup. Kept separate from jobs.ts (the queue) so the queue has no
 * dependency on feature modules — avoids import cycles.
 */
export function registerJobHandlers(): void {
	registerJobHandler('rss_poll', async (payload) => {
		const channelId = String(payload.channelId ?? '');
		if (channelId) await pollChannel(channelId);
	});

	registerJobHandler('metadata', async (payload) => {
		const videoId = String(payload.videoId ?? '');
		if (videoId) await fillFeedItemDuration(videoId);
	});

	registerJobHandler('expire_feed', async () => {
		expireOldFeedItems();
		pruneJobs();
	});

	registerJobHandler('cleanup', async () => {
		runCleanupSweep();
	});

	registerJobHandler('recommended_scrape', async () => {
		await runRecommendedScrape();
	});

	registerJobHandler('history_sync', async (payload) => {
		const videoId = String(payload.videoId ?? '');
		if (videoId) await runHistorySync(videoId);
	});

	registerJobHandler('playlist_sync', async () => {
		await syncPlaylist();
	});

	registerJobHandler('playlist_remove', async (payload) => {
		const videoId = String(payload.videoId ?? '');
		if (videoId) await removeFromPlaylist(videoId);
	});

	registerJobHandler('backfill_metadata', async (payload) => {
		const videoId = String(payload.videoId ?? '');
		if (videoId) await backfillVideo(videoId);
	});

	// When a video is marked watched: ping YouTube history, and — only when the
	// playlist is NOT acting as a pure download queue — remove it from the synced
	// playlist now. Both self-gate on their own flags too.
	setWatchedHook((videoId) => {
		enqueueHistorySync(videoId);
		if (!getSettings().playlistRemoveOnDownload) enqueuePlaylistRemove(videoId);
	});

	// Playlist-as-queue: remove an item from the synced playlist as soon as it's
	// downloaded, so the playlist only ever holds not-yet-grabbed videos.
	setDownloadedHook((videoId) => {
		if (getSettings().playlistRemoveOnDownload) enqueuePlaylistRemove(videoId);
	});
}
