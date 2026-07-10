import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from './db';
import { jobs, type Job } from './db/schema';

/**
 * Generic background job queue (everything that isn't a media download):
 * RSS polls, lazy metadata, feed expiry, cleanup sweeps, recommended scrapes,
 * history sync. DB-backed and restart-safe; handlers register by type.
 */

export type JobType = Job['type'];
export type JobHandler = (payload: Record<string, unknown>, job: Job) => Promise<void>;

const handlers = new Map<JobType, JobHandler>();
const inFlight = new Set<number>();
const MAX_CONCURRENT_JOBS = 3;

export function registerJobHandler(type: JobType, handler: JobHandler): void {
	handlers.set(type, handler);
}

export interface EnqueueJobOptions {
	dedupeKey?: string;
	runAfter?: Date;
	priority?: number;
	maxAttempts?: number;
}

/**
 * Enqueue a job. When `dedupeKey` is given and a non-terminal job with that key
 * already exists, this is a no-op (prevents piling up duplicate RSS polls etc).
 *
 * Terminal (done/failed) rows KEEP their dedupe key for history and must never
 * block a re-enqueue — otherwise a recurring job runs exactly once. That's what
 * `uq_jobs_dedupe_pending` (a *partial* unique index over queued/active rows)
 * guarantees; `onConflictDoNothing` below only absorbs a genuine race.
 */
export function enqueueJob(
	type: JobType,
	payload: Record<string, unknown> = {},
	opts: EnqueueJobOptions = {}
): void {
	if (opts.dedupeKey) {
		const existing = db
			.select({ id: jobs.id })
			.from(jobs)
			.where(and(eq(jobs.dedupeKey, opts.dedupeKey), inArray(jobs.status, ['queued', 'active'])))
			.get();
		if (existing) return;
	}
	db.insert(jobs)
		.values({
			type,
			payload,
			dedupeKey: opts.dedupeKey ?? null,
			runAfter: opts.runAfter ?? new Date(),
			priority: opts.priority ?? 0,
			maxAttempts: opts.maxAttempts ?? 3
		})
		.onConflictDoNothing()
		.run();
}

export function resetStuckJobs(): void {
	db.update(jobs).set({ status: 'queued' }).where(eq(jobs.status, 'active')).run();
}

export function tick(): void {
	const free = MAX_CONCURRENT_JOBS - inFlight.size;
	if (free <= 0) return;
	const now = Date.now();
	const candidates = db
		.select()
		.from(jobs)
		.where(and(eq(jobs.status, 'queued'), sql`${jobs.runAfter} <= ${now}`))
		.orderBy(sql`${jobs.priority} desc, ${jobs.createdAt} asc`)
		.limit(free)
		.all();

	for (const job of candidates) {
		if (inFlight.has(job.id)) continue;
		inFlight.add(job.id);
		db.update(jobs).set({ status: 'active', startedAt: new Date() }).where(eq(jobs.id, job.id)).run();
		run(job).finally(() => inFlight.delete(job.id));
	}
}

async function run(job: Job): Promise<void> {
	const handler = handlers.get(job.type);
	if (!handler) {
		db.update(jobs)
			.set({ status: 'failed', error: `no handler for ${job.type}`, finishedAt: new Date() })
			.where(eq(jobs.id, job.id))
			.run();
		return;
	}
	try {
		await handler((job.payload as Record<string, unknown>) ?? {}, job);
		db.update(jobs).set({ status: 'done', finishedAt: new Date() }).where(eq(jobs.id, job.id)).run();
	} catch (err) {
		const attempts = job.attempts + 1;
		const message = err instanceof Error ? err.message : String(err);
		if (attempts < job.maxAttempts) {
			const backoff = 60_000 * 2 ** (attempts - 1);
			db.update(jobs)
				.set({ status: 'queued', attempts, error: message.slice(-2000), runAfter: new Date(Date.now() + backoff) })
				.where(eq(jobs.id, job.id))
				.run();
		} else {
			db.update(jobs)
				.set({ status: 'failed', attempts, error: message.slice(-2000), finishedAt: new Date() })
				.where(eq(jobs.id, job.id))
				.run();
		}
	}
}

/** Delete old terminal jobs so the table doesn't grow unbounded. */
export function pruneJobs(olderThanMs = 7 * 24 * 60 * 60 * 1000): void {
	const cutoff = Date.now() - olderThanMs;
	db.delete(jobs)
		.where(and(inArray(jobs.status, ['done', 'failed']), sql`${jobs.finishedAt} < ${cutoff}`))
		.run();
}
