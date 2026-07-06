import fs from 'node:fs';
import { desc, eq } from 'drizzle-orm';
import { db } from './db';
import { channels, jobs } from './db/schema';
import { enqueueJob } from './jobs';
import { getSetting } from './settings';
import { config } from './config';
import { playlistSyncActive } from './playlist-sync';

/**
 * Periodic scheduling. Called from the worker loop (~once a minute). Decides
 * which channels are due for an RSS poll (jittered per-channel so we don't
 * hammer YouTube in lockstep) and schedules maintenance sweeps.
 */

export function scheduleDuePolls(): void {
	const intervalMs = getSetting('rssPollIntervalMin') * 60_000;
	const now = Date.now();
	const rows = db.select({ id: channels.id, lastPolledAt: channels.lastPolledAt }).from(channels).all();
	for (const c of rows) {
		const last = c.lastPolledAt?.getTime() ?? 0;
		// Per-channel jitter of ±15% keeps polls spread out.
		const jitter = 1 + (jitterFor(c.id) - 0.5) * 0.3;
		if (now - last >= intervalMs * jitter) {
			enqueueJob('rss_poll', { channelId: c.id }, { dedupeKey: `rss:${c.id}` });
		}
	}
}

/**
 * Schedule recommended-feed scrapes 2–4×/day (jittered). Gated on the feature
 * flag + presence of cookies. Uses the last recommended_scrape job's timestamp
 * so it survives restarts without re-scraping on every boot.
 */
export function scheduleRecommended(): void {
	if (!config.recommendedFeedEnabled) return;
	if (!fs.existsSync(config.cookiesPath)) return;

	const perDay = Math.min(4, Math.max(2, getSetting('recommendedPollsPerDay')));
	const intervalMs = (24 * 60 * 60_000) / perDay;
	const last = db
		.select({ createdAt: jobs.createdAt })
		.from(jobs)
		.where(eq(jobs.type, 'recommended_scrape'))
		.orderBy(desc(jobs.createdAt))
		.limit(1)
		.get();
	const jitter = 1 + (Math.random() - 0.5) * 0.4; // ±20%
	const due = !last || Date.now() - last.createdAt.getTime() >= intervalMs * jitter;
	if (due) enqueueJob('recommended_scrape', {}, { dedupeKey: 'recommended_scrape' });
}

/**
 * Poll the synced YouTube playlist frequently (every ~5 min) so a video added
 * on your phone shows up in MyTube quickly — this is the P0 responsiveness path.
 */
const PLAYLIST_SYNC_INTERVAL_MS = 5 * 60_000;
export function schedulePlaylistSync(): void {
	if (!playlistSyncActive()) return;
	const last = db
		.select({ createdAt: jobs.createdAt })
		.from(jobs)
		.where(eq(jobs.type, 'playlist_sync'))
		.orderBy(desc(jobs.createdAt))
		.limit(1)
		.get();
	const due = !last || Date.now() - last.createdAt.getTime() >= PLAYLIST_SYNC_INTERVAL_MS;
	if (due) enqueueJob('playlist_sync', {}, { dedupeKey: 'playlist_sync' });
}

let lastMaintenance = 0;
export function scheduleMaintenance(): void {
	const now = Date.now();
	// Roughly hourly.
	if (now - lastMaintenance < 60 * 60_000) return;
	lastMaintenance = now;
	enqueueJob('expire_feed', {}, { dedupeKey: 'expire_feed' });
	enqueueJob('cleanup', {}, { dedupeKey: 'cleanup' });
}

// Stable per-id jitter in [0,1) without Math.random (reproducible).
function jitterFor(id: string): number {
	let h = 0;
	for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
	return (h % 1000) / 1000;
}
