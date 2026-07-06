import { registerJobHandler, pruneJobs } from './jobs';
import { pollChannel, fillFeedItemDuration, expireOldFeedItems } from './feed';
import { runCleanupSweep, setWatchedHook } from './lifecycle';
import { runRecommendedScrape } from './recommended-scraper';
import { enqueueHistorySync, runHistorySync } from './history-sync';

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

	// When a video is marked watched, (optionally) sync it to YouTube history.
	setWatchedHook(enqueueHistorySync);
}
