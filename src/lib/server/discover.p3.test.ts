import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';

/**
 * Pool quality: the channel blocklist and stale-item expiry.
 *
 * Both can silently destroy user intent if they overreach — a blocklist that
 * matches the wrong channel, or an expiry pass that deletes rows recording a
 * decision the user already made (grabbed / dismissed / not_interested). If
 * those decisions were deleted, the next scrape would cheerfully re-ingest what
 * they rejected.
 */

const { dbPath } = vi.hoisted(() => {
	const base = process.env.TMPDIR || '/tmp';
	const uniq = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
	return { dbPath: `${base}/mytube-p3-${uniq}/test.db` };
});
vi.mock('$lib/server/config', () => ({
	config: { databasePath: dbPath, recommendedFeedEnabled: true, cookiesPath: '/nonexistent' }
}));

let expiryDays = 14;
vi.mock('./settings', () => ({ getSettings: () => ({ recommendedExpiryDays: expiryDays }) }));
// discover imports enqueueDownload; we never call grab here.
vi.mock('./downloads', () => ({ enqueueDownload: () => ({ status: 'queued' }) }));

type Db = typeof import('./db');
type Schema = typeof import('./db/schema');
type Discover = typeof import('./discover');
type Drizzle = typeof import('drizzle-orm');

let D: Db, S: Schema, C: Discover, O: Drizzle;

beforeAll(async () => {
	const { runMigrations } = await import('./db/migrate');
	runMigrations();
	D = await import('./db');
	S = await import('./db/schema');
	C = await import('./discover');
	O = await import('drizzle-orm');
});

const item = (videoId: string, channelName: string | null, channelId: string | null) => ({
	videoId,
	title: videoId,
	channelName,
	channelId,
	durationSeconds: 100,
	thumbnailUrl: null
});

const poolIds = () => D.db.select().from(S.recommendations).all().map((r) => r.videoId);
const statusOf = (videoId: string) =>
	D.db.select().from(S.recommendations).where(O.eq(S.recommendations.videoId, videoId)).get()?.status;
const rowId = (videoId: string) =>
	D.db.select().from(S.recommendations).where(O.eq(S.recommendations.videoId, videoId)).get()!.id;

beforeEach(() => {
	expiryDays = 14;
	D.db.delete(S.recommendations).run();
	D.db.delete(S.blockedChannels).run();
	D.db.delete(S.videos).run();
});

describe('channel blocklist', () => {
	it('writes to a throwaway db, not the real one', () => {
		expect(dbPath).not.toContain('data/mytube.db');
	});

	it('not-interested blocks the channel and sweeps its other pooled items', () => {
		C.ingestRecommended([
			item('a1', 'Spam Co', 'UCspam0000000000000000'),
			item('a2', 'Spam Co', 'UCspam0000000000000000'),
			item('b1', 'Good Co', 'UCgood0000000000000000')
		]);
		C.notInterestedRecommendation(rowId('a1'));

		expect(statusOf('a1')).toBe('not_interested');
		expect(statusOf('a2')).toBe('not_interested'); // swept, not left behind
		expect(statusOf('b1')).toBe('new');
	});

	// Caught live: rows ingested before the parser learned to read the watch-page
	// avatar have a null channelId. Sweeping on channelId alone left 8 of one
	// channel's 20 cards sitting on Discover after the user blocked it.
	it('sweeps siblings that predate channelId extraction (null id, same name)', () => {
		C.ingestRecommended([
			item('has-id', 'Mixed Co', 'UCmixed000000000000000'),
			item('no-id-1', 'Mixed Co', null),
			item('no-id-2', 'MIXED CO', null)
		]);
		C.notInterestedRecommendation(rowId('has-id'));

		expect(statusOf('no-id-1')).toBe('not_interested');
		expect(statusOf('no-id-2')).toBe('not_interested');
	});

	it('drops blocked channels at ingest, by channelId', () => {
		C.ingestRecommended([item('a1', 'Spam Co', 'UCspam0000000000000000')]);
		C.notInterestedRecommendation(rowId('a1'));

		// Same channelId, DIFFERENT display name — must still be blocked.
		const added = C.ingestRecommended([item('a3', 'Spam Co Rebranded', 'UCspam0000000000000000')]);
		expect(added).toBe(0);
		expect(poolIds()).not.toContain('a3');
	});

	it('falls back to channelName when there is no channelId', () => {
		C.ingestRecommended([item('n1', 'Nameless Co', null)]);
		C.notInterestedRecommendation(rowId('n1'));

		// Case/whitespace-insensitive, since it's a display string.
		const added = C.ingestRecommended([item('n2', '  nameless co ', null)]);
		expect(added).toBe(0);
	});

	it('does not block an unrelated channel that merely shares an id-less name prefix', () => {
		C.ingestRecommended([item('n1', 'News', null)]);
		C.notInterestedRecommendation(rowId('n1'));
		expect(C.ingestRecommended([item('n3', 'News Weekly', null)])).toBe(1);
	});

	it('blocking a name-only channel twice does not duplicate the blocklist row', () => {
		C.ingestRecommended([item('n1', 'Dupe Co', null), item('n2', 'Dupe Co', null)]);
		C.notInterestedRecommendation(rowId('n1'));
		// n2 was swept to not_interested; block it again explicitly.
		C.notInterestedRecommendation(rowId('n2'));
		expect(D.db.select().from(S.blockedChannels).all()).toHaveLength(1);
	});
});

describe('stale pool expiry', () => {
	function age(videoId: string, days: number) {
		D.db
			.update(S.recommendations)
			.set({ seenAt: new Date(Date.now() - days * 24 * 60 * 60 * 1000) })
			.where(O.eq(S.recommendations.videoId, videoId))
			.run();
	}

	it('deletes untouched new rows past the cutoff, keeps fresh ones', () => {
		C.ingestRecommended([item('old', 'C', null), item('fresh', 'C2', null)]);
		age('old', 30);
		expect(C.expireStaleRecommendations()).toBe(1);
		expect(poolIds()).toEqual(['fresh']);
	});

	it('never deletes rows recording a user decision', () => {
		C.ingestRecommended([item('grabbed', 'C', null), item('dismissed', 'C2', null)]);
		D.db.update(S.recommendations).set({ status: 'downloaded' }).where(O.eq(S.recommendations.videoId, 'grabbed')).run();
		D.db.update(S.recommendations).set({ status: 'dismissed' }).where(O.eq(S.recommendations.videoId, 'dismissed')).run();
		age('grabbed', 90);
		age('dismissed', 90);

		expect(C.expireStaleRecommendations()).toBe(0);
		expect(poolIds().sort()).toEqual(['dismissed', 'grabbed']);
	});

	it('is disabled when expiry days is 0', () => {
		C.ingestRecommended([item('ancient', 'C', null)]);
		age('ancient', 3650);
		expiryDays = 0;
		expect(C.expireStaleRecommendations()).toBe(0);
		expect(poolIds()).toEqual(['ancient']);
	});
});
