import { resetStuckDownloads, tick as downloadsTick } from './downloads';
import { resetStuckJobs, tick as jobsTick } from './jobs';
import { registerJobHandlers } from './job-handlers';
import { scheduleDuePolls, scheduleMaintenance } from './scheduler';

/**
 * Background worker orchestration. Started once at boot from bootstrap.ts.
 *
 * Three cadences on unref'd intervals:
 *   - download queue  (fast)   — pull downloads into free slots
 *   - job queue       (fast)   — RSS polls, metadata, expiry, cleanup, sync
 *   - scheduler       (slow)   — decide which channels are due to poll
 */
const globalForWorker = globalThis as unknown as {
	__haystackWorkers?: boolean;
	__haystackTimers?: NodeJS.Timeout[];
};

const DOWNLOAD_TICK_MS = 2000;
const JOB_TICK_MS = 2000;
const SCHEDULER_TICK_MS = 60_000;

export function startWorkers() {
	if (globalForWorker.__haystackWorkers) return;
	globalForWorker.__haystackWorkers = true;

	// Recover from an unclean shutdown before pulling new work.
	resetStuckDownloads();
	resetStuckJobs();
	registerJobHandlers();

	const timers: NodeJS.Timeout[] = [];
	timers.push(safeInterval(downloadsTick, DOWNLOAD_TICK_MS, 'downloads'));
	timers.push(safeInterval(jobsTick, JOB_TICK_MS, 'jobs'));
	timers.push(
		safeInterval(
			() => {
				scheduleDuePolls();
				scheduleMaintenance();
			},
			SCHEDULER_TICK_MS,
			'scheduler'
		)
	);
	globalForWorker.__haystackTimers = timers;

	// Kick a scheduler pass shortly after boot so fresh installs poll promptly.
	setTimeout(() => {
		try {
			scheduleDuePolls();
		} catch (err) {
			console.error('[worker:scheduler] initial pass', err);
		}
	}, 5000).unref?.();

	console.log('[worker] started');
}

function safeInterval(fn: () => void | Promise<void>, ms: number, name: string): NodeJS.Timeout {
	const t = setInterval(() => {
		try {
			void Promise.resolve(fn()).catch((err) => console.error(`[worker:${name}]`, err));
		} catch (err) {
			console.error(`[worker:${name}]`, err);
		}
	}, ms);
	t.unref?.();
	return t;
}
