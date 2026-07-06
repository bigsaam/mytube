import { db } from './db';
import { channels } from './db/schema';
import { enqueueJob } from './jobs';
import { getSetting } from './settings';

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
