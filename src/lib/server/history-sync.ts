import fs from 'node:fs';
import { eq } from 'drizzle-orm';
import { db } from './db';
import { videos } from './db/schema';
import { config } from './config';
import { getSettings } from './settings';
import { enqueueJob } from './jobs';
import { markWatchedRemote } from './ytdlp';
import { watchUrl } from './youtube-url';

/**
 * Optional YouTube watch-history write-back. When a video is marked watched
 * locally (and history sync is enabled, cookies exist, and the video isn't
 * opted out), we enqueue a jittered `history_sync` job. Jitter avoids firing
 * the instant playback ends; failures never affect the local watched flow.
 */

/** Called from the watched hook. Safe to call always — it self-gates. */
export function enqueueHistorySync(videoId: string): void {
	if (!config.historySyncEnabled) return;
	if (!fs.existsSync(config.cookiesPath)) return;

	const row = db
		.select({ optout: videos.historySyncOptout })
		.from(videos)
		.where(eq(videos.videoId, videoId))
		.get();
	if (!row || row.optout) return;

	const s = getSettings();
	const minMs = Math.max(0, s.historySyncMinDelayMin) * 60_000;
	const maxMs = Math.max(minMs, s.historySyncMaxDelayMin * 60_000);
	const delay = minMs + Math.random() * (maxMs - minMs);

	enqueueJob(
		'history_sync',
		{ videoId },
		{
			dedupeKey: `hist:${videoId}`,
			runAfter: new Date(Date.now() + delay),
			priority: -5, // low priority; downloads/polls come first
			maxAttempts: 3 // 2 retries then give up quietly
		}
	);
}

/** history_sync job handler. */
export async function runHistorySync(videoId: string): Promise<void> {
	if (!config.historySyncEnabled) return; // flipped off since enqueue
	const row = db
		.select({ optout: videos.historySyncOptout })
		.from(videos)
		.where(eq(videos.videoId, videoId))
		.get();
	if (!row || row.optout) return;
	await markWatchedRemote(watchUrl(videoId));
}
