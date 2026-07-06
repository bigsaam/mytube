import fs from 'node:fs';
import { config } from '$lib/server/config';
import { runMigrations } from '$lib/server/db/migrate';
import { startWorkers } from '$lib/server/worker';

/**
 * One-time process startup. Runs migrations, ensures media/data dirs exist, and
 * (from Phase 2 on) boots the background worker + scheduler. Guarded so it runs
 * exactly once even across dev HMR reloads.
 */
const globalForBoot = globalThis as unknown as { __haystackBooted?: boolean };

export function bootstrap() {
	if (globalForBoot.__haystackBooted) return;
	globalForBoot.__haystackBooted = true;

	fs.mkdirSync(config.mediaRoot, { recursive: true });
	fs.mkdirSync(config.dataRoot, { recursive: true });

	runMigrations();

	// Background workers (download queue, job queue, schedulers).
	startWorkers();
}
