import { describe, it, expect, beforeAll, vi } from 'vitest';

/**
 * Regression tests for the `dedupe_key` invariant.
 *
 * The bug: `jobs.dedupe_key` had a plain UNIQUE index over ALL rows, so a
 * *completed* job kept its key forever and every recurring re-enqueue threw
 * SQLITE_CONSTRAINT_UNIQUE — killing the scheduler tick (and, because the
 * schedulers shared one try block, silently preventing recommended_scrape and
 * maintenance from ever running).
 *
 * The invariant is "at most one PENDING job per dedupe key", enforced by the
 * partial index `uq_jobs_dedupe_pending`. Under the old index this file fails:
 * a bare insert throws, and `onConflictDoNothing` silently yields 1 row instead
 * of 2 — so `lets a recurring job re-enqueue` catches either regression.
 */

// `$env/dynamic/private` snapshots the environment at vite startup, so setting
// process.env at runtime would NOT redirect the DB — the suite would scribble
// into the real ./data/mytube.db. Mock config to a throwaway file instead.
const { dbPath } = vi.hoisted(() => {
	const base = process.env.TMPDIR || '/tmp';
	const uniq = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
	return { dbPath: `${base}/mytube-jobs-${uniq}/test.db` };
});
vi.mock('$lib/server/config', () => ({ config: { databasePath: dbPath } }));

type Db = typeof import('./db');
type Schema = typeof import('./db/schema');
type Jobs = typeof import('./jobs');
type Drizzle = typeof import('drizzle-orm');

let D: Db;
let S: Schema;
let J: Jobs;
let O: Drizzle;

beforeAll(async () => {
	const { runMigrations } = await import('./db/migrate');
	runMigrations();
	D = await import('./db');
	S = await import('./db/schema');
	J = await import('./jobs');
	O = await import('drizzle-orm');
});

function rowsWithKey(key: string) {
	return D.db.select().from(S.jobs).where(O.eq(S.jobs.dedupeKey, key)).all();
}

describe('enqueueJob dedupe_key', () => {
	it('writes to a throwaway db, not the real one', () => {
		expect(dbPath).not.toContain('data/mytube.db');
	});

	it('is a no-op (not a throw) while an identical job is still pending', () => {
		expect(() => J.enqueueJob('cleanup', {}, { dedupeKey: 'k-pending' })).not.toThrow();
		expect(() => J.enqueueJob('cleanup', {}, { dedupeKey: 'k-pending' })).not.toThrow();
		expect(rowsWithKey('k-pending')).toHaveLength(1);
	});

	it('lets a recurring job re-enqueue once the previous one is done', () => {
		J.enqueueJob('playlist_sync', {}, { dedupeKey: 'k-recurring' });
		const first = rowsWithKey('k-recurring');
		expect(first).toHaveLength(1);

		// Complete it exactly as the job runner does — the key is retained.
		D.db
			.update(S.jobs)
			.set({ status: 'done', finishedAt: new Date() })
			.where(O.eq(S.jobs.id, first[0].id))
			.run();

		// The regression: used to throw SQLITE_CONSTRAINT_UNIQUE (old code), or
		// silently insert nothing (old index + onConflictDoNothing).
		expect(() => J.enqueueJob('playlist_sync', {}, { dedupeKey: 'k-recurring' })).not.toThrow();

		const after = rowsWithKey('k-recurring');
		expect(after).toHaveLength(2);
		expect(after.filter((r) => r.status === 'queued')).toHaveLength(1);
		expect(after.filter((r) => r.status === 'done')).toHaveLength(1);
	});

	it('a failed job also does not block re-enqueue', () => {
		J.enqueueJob('rss_poll', {}, { dedupeKey: 'k-failed' });
		const [job] = rowsWithKey('k-failed');
		D.db.update(S.jobs).set({ status: 'failed' }).where(O.eq(S.jobs.id, job.id)).run();

		expect(() => J.enqueueJob('rss_poll', {}, { dedupeKey: 'k-failed' })).not.toThrow();
		expect(rowsWithKey('k-failed')).toHaveLength(2);
	});

	it('keeps distinct keys independent, and allows many null keys', () => {
		J.enqueueJob('cleanup', {}, { dedupeKey: 'k-a' });
		J.enqueueJob('cleanup', {}, { dedupeKey: 'k-b' });
		expect(rowsWithKey('k-a')).toHaveLength(1);
		expect(rowsWithKey('k-b')).toHaveLength(1);

		// No dedupe key → never collides (SQLite treats NULLs as distinct).
		expect(() => {
			J.enqueueJob('metadata', { videoId: 'a' });
			J.enqueueJob('metadata', { videoId: 'b' });
		}).not.toThrow();
	});
});
