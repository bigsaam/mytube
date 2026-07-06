import { registerJobHandler, pruneJobs } from './jobs';
import { pollChannel, fillFeedItemDuration, expireOldFeedItems } from './feed';

/**
 * Wires job types to their handlers. Called once at worker startup. Kept
 * separate from jobs.ts (the queue) so the queue has no dependency on the
 * feature modules — avoids import cycles.
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

	// 'cleanup' registered in Phase 5; 'recommended_scrape' / 'history_sync' in Phase 6.
}
