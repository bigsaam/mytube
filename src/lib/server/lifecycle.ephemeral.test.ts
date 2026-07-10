import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';

/**
 * Stream-and-discard ("Watch now" from Discover) deletes files, so its
 * exemptions are load-bearing:
 *
 *  - it prunes watched ephemeral videos even under `keep_forever`, because an
 *    ephemeral video was never meant to be kept;
 *  - it must NOT touch an ephemeral video that hasn't been watched yet (the user
 *    is very likely still watching it);
 *  - it must NOT touch a pinned one — Keep is the escape hatch.
 *
 * Pins are guarded twice: by the sweep's query AND by `deleteFiles` itself, so
 * the pin test passes even if the query's `pinned` condition is deleted. That
 * redundancy is deliberate; don't "simplify" either layer away on the grounds
 * that a test still passes.
 */

const { dbPath, mediaRoot } = vi.hoisted(() => {
	const base = process.env.TMPDIR || '/tmp';
	const uniq = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
	return { dbPath: `${base}/mytube-ephemeral-${uniq}/test.db`, mediaRoot: `${base}/mytube-ephemeral-${uniq}/media` };
});
vi.mock('$lib/server/config', () => ({ config: { databasePath: dbPath, mediaRoot } }));
// keep_forever proves the ephemeral pass is independent of the global policy.
vi.mock('./settings', () => ({
	getSettings: () => ({ cleanupPolicy: 'keep_forever', cleanupKeepDays: 30, cleanupPlaylistWatched: false })
}));

type Db = typeof import('./db');
type Schema = typeof import('./db/schema');
type Lifecycle = typeof import('./lifecycle');
type Drizzle = typeof import('drizzle-orm');

let D: Db, S: Schema, L: Lifecycle, O: Drizzle;

beforeAll(async () => {
	const { runMigrations } = await import('./db/migrate');
	runMigrations();
	D = await import('./db');
	S = await import('./db/schema');
	L = await import('./lifecycle');
	O = await import('drizzle-orm');
});

interface VideoOpts {
	watched?: boolean;
	pinned?: boolean;
	ephemeral?: boolean;
}

function addVideo(videoId: string, opts: VideoOpts) {
	D.db
		.insert(S.videos)
		.values({
			videoId,
			title: videoId,
			status: 'ready',
			// A non-null videoPath is what makes a row eligible for pruning.
			videoPath: `${videoId}/video.mp4`,
			watched: !!opts.watched,
			watchedAt: opts.watched ? new Date() : null,
			pinned: !!opts.pinned,
			ephemeral: !!opts.ephemeral
		})
		.run();
}

const filesDeleted = (videoId: string) =>
	!!D.db.select().from(S.videos).where(O.eq(S.videos.videoId, videoId)).get()?.filesDeleted;

beforeEach(() => {
	D.db.delete(S.videos).run();
});

describe('runCleanupSweep — ephemeral pass', () => {
	it('writes to a throwaway db, not the real one', () => {
		expect(dbPath).not.toContain('data/mytube.db');
	});

	it('prunes a watched ephemeral video even under keep_forever', () => {
		addVideo('gone', { watched: true, ephemeral: true });
		expect(L.runCleanupSweep()).toBe(1);
		expect(filesDeleted('gone')).toBe(true);
	});

	it('leaves an ephemeral video that is not yet watched', () => {
		addVideo('watching', { watched: false, ephemeral: true });
		expect(L.runCleanupSweep()).toBe(0);
		expect(filesDeleted('watching')).toBe(false);
	});

	it('leaves a pinned ephemeral video (Keep is the escape hatch)', () => {
		addVideo('kept', { watched: true, ephemeral: true, pinned: true });
		expect(L.runCleanupSweep()).toBe(0);
		expect(filesDeleted('kept')).toBe(false);
	});

	it('leaves an ordinary watched video under keep_forever', () => {
		addVideo('library', { watched: true, ephemeral: false });
		expect(L.runCleanupSweep()).toBe(0);
		expect(filesDeleted('library')).toBe(false);
	});
});
