import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';

/**
 * `listPlayQueue` turns a compact `?list=` descriptor into an ordered, playable
 * queue for the player's autoplay-next + repeat. The load-bearing rules:
 *  - only `ready`, non-deleted videos are queueable (every item must play);
 *  - `wl` yields the Watch Later order; `all` the whole library; `ch:<id>` one
 *    channel; anything else is an empty queue (no accidental full-library play).
 */

const { dbPath, mediaRoot } = vi.hoisted(() => {
	const base = process.env.TMPDIR || '/tmp';
	const uniq = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
	return { dbPath: `${base}/mytube-queue-${uniq}/test.db`, mediaRoot: `${base}/mytube-queue-${uniq}/media` };
});
vi.mock('$lib/server/config', () => ({ config: { databasePath: dbPath, mediaRoot } }));

type Db = typeof import('./db');
type Schema = typeof import('./db/schema');
type Library = typeof import('./library');

let D: Db, S: Schema, L: Library;

beforeAll(async () => {
	const { runMigrations } = await import('./db/migrate');
	runMigrations();
	D = await import('./db');
	S = await import('./db/schema');
	L = await import('./library');
});

interface VideoOpts {
	status?: Schema['videos']['$inferSelect']['status'];
	filesDeleted?: boolean;
	channelId?: string;
	watchLater?: boolean;
	watchLaterOrder?: number;
}

function addVideo(videoId: string, opts: VideoOpts = {}) {
	D.db
		.insert(S.videos)
		.values({
			videoId,
			title: `title-${videoId}`,
			status: opts.status ?? 'ready',
			videoPath: `${videoId}/video.mp4`,
			filesDeleted: !!opts.filesDeleted,
			channelId: opts.channelId ?? null,
			inWatchLater: !!opts.watchLater,
			watchLaterOrder: opts.watchLaterOrder ?? null
		})
		.run();
}

const ids = (list: string) => L.listPlayQueue(list).map((q) => q.videoId);

beforeEach(() => {
	D.db.delete(S.videos).run();
});

describe('listPlayQueue', () => {
	it('all: returns every ready, non-deleted video', () => {
		addVideo('aaaaaaaaaaa');
		addVideo('bbbbbbbbbbb');
		expect(ids('all').sort()).toEqual(['aaaaaaaaaaa', 'bbbbbbbbbbb']);
	});

	it('all: excludes not-yet-downloaded and cleaned videos', () => {
		addVideo('ready000000');
		addVideo('pending0000', { status: 'pending' });
		addVideo('cleaned0000', { filesDeleted: true });
		expect(ids('all')).toEqual(['ready000000']);
	});

	it('wl: returns only Watch Later, in queue order', () => {
		addVideo('first000000', { watchLater: true, watchLaterOrder: 0 });
		addVideo('second00000', { watchLater: true, watchLaterOrder: 1 });
		addVideo('notqueued00', { watchLater: false });
		expect(ids('wl')).toEqual(['first000000', 'second00000']);
	});

	it('ch:<id>: filters to a single channel', () => {
		addVideo('chan0000001', { channelId: 'UC_music' });
		addVideo('chan0000002', { channelId: 'UC_music' });
		addVideo('other000000', { channelId: 'UC_other' });
		expect(ids('ch:UC_music').sort()).toEqual(['chan0000001', 'chan0000002']);
	});

	it('unknown descriptor yields an empty queue', () => {
		addVideo('aaaaaaaaaaa');
		expect(L.listPlayQueue('bogus')).toEqual([]);
		expect(L.listPlayQueue('')).toEqual([]);
	});

	it('queue items expose videoId + title', () => {
		addVideo('withtitle00');
		expect(L.listPlayQueue('all')).toEqual([{ videoId: 'withtitle00', title: 'title-withtitle00' }]);
	});
});
