/**
 * Background worker orchestration. Started once at boot from bootstrap.ts.
 *
 * Phase 1: inert (no queues exist yet). The download worker, generic job
 * worker, and schedulers are wired in from Phase 2 onward. Kept as a stable
 * entry point so bootstrap never needs to change.
 */
const globalForWorker = globalThis as unknown as { __haystackWorkers?: boolean };

export function startWorkers() {
	if (globalForWorker.__haystackWorkers) return;
	globalForWorker.__haystackWorkers = true;
	// Later phases register loops here.
}
