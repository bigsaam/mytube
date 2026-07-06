import { resetStuckDownloads, tick as downloadsTick } from './downloads';

/**
 * Background worker orchestration. Started once at boot from bootstrap.ts.
 *
 * A single setInterval drives the download queue. Later phases add the generic
 * job queue and the RSS / recommended / cleanup schedulers to the same tick.
 */
const globalForWorker = globalThis as unknown as {
	__haystackWorkers?: boolean;
	__haystackTimers?: NodeJS.Timeout[];
};

const DOWNLOAD_TICK_MS = 2000;

export function startWorkers() {
	if (globalForWorker.__haystackWorkers) return;
	globalForWorker.__haystackWorkers = true;

	// Recover from an unclean shutdown before we start pulling new work.
	resetStuckDownloads();

	const timers: NodeJS.Timeout[] = [];
	timers.push(safeInterval(downloadsTick, DOWNLOAD_TICK_MS, 'downloads'));
	globalForWorker.__haystackTimers = timers;

	console.log('[worker] started');
}

/** setInterval that never lets a thrown tick kill the loop. */
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
