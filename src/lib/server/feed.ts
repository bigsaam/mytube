import { and, desc, eq, inArray, lt, sql } from 'drizzle-orm';
import { db } from './db';
import { channels, feedItems, videos, type Channel, type FeedItem } from './db/schema';
import { enqueueDownload } from './downloads';
import { enqueueJob } from './jobs';
import { fetchChannelFeed, type FeedEntry } from './rss';
import { getSetting } from './settings';
import { watchUrl } from './youtube-url';

/**
 * Feed ingestion + actions. Subscription uploads (and, in Phase 6, recommended
 * items) surface here as `feed_items` the user can Grab / Watch Later / Dismiss.
 */

/** Poll one channel's RSS and ingest new uploads. Called by the rss_poll job. */
export async function pollChannel(channelId: string): Promise<void> {
	const channel = db.select().from(channels).where(eq(channels.id, channelId)).get();
	if (!channel) return;

	const feed = await fetchChannelFeed(channelId);

	// Keep channel name fresh.
	if (feed.channelName && feed.channelName !== channel.name) {
		db.update(channels).set({ name: feed.channelName }).where(eq(channels.id, channelId)).run();
	}

	ingestEntries(channel, feed.entries);
	db.update(channels).set({ lastPolledAt: new Date() }).where(eq(channels.id, channelId)).run();
}

export function ingestEntries(channel: Channel, entries: FeedEntry[]): number {
	if (!entries.length) return 0;
	const ids = entries.map((e) => e.videoId);

	// Skip anything already in the library or already surfaced from subscriptions.
	const known = new Set(
		db
			.select({ videoId: videos.videoId })
			.from(videos)
			.where(inArray(videos.videoId, ids))
			.all()
			.map((r) => r.videoId)
	);
	const existingFeed = new Set(
		db
			.select({ videoId: feedItems.videoId })
			.from(feedItems)
			.where(and(inArray(feedItems.videoId, ids), eq(feedItems.source, 'subscription')))
			.all()
			.map((r) => r.videoId)
	);

	let added = 0;
	for (const e of entries) {
		if (known.has(e.videoId) || existingFeed.has(e.videoId)) continue;

		if (channel.autoGrab) {
			// Auto-grab channels never miss: queue immediately, record as grabbed.
			enqueueDownload({
				videoId: e.videoId,
				title: e.title,
				channelId: channel.id,
				channelName: channel.name,
				thumbnailUrl: e.thumbnailUrl
			});
			db.insert(feedItems)
				.values({
					videoId: e.videoId,
					source: 'subscription',
					channelId: channel.id,
					channelName: channel.name,
					title: e.title,
					thumbnailUrl: e.thumbnailUrl,
					publishedAt: e.publishedAt,
					status: 'grabbed'
				})
				.onConflictDoNothing()
				.run();
		} else {
			db.insert(feedItems)
				.values({
					videoId: e.videoId,
					source: 'subscription',
					channelId: channel.id,
					channelName: channel.name,
					title: e.title,
					thumbnailUrl: e.thumbnailUrl,
					publishedAt: e.publishedAt,
					status: 'new'
				})
				.onConflictDoNothing()
				.run();
			// Lazily fetch duration (not in RSS) without blocking ingestion.
			enqueueJob('metadata', { videoId: e.videoId }, { dedupeKey: `meta:${e.videoId}` });
		}
		added++;
	}
	return added;
}

/**
 * Ingest recommended-feed items. Deduped against the library and against
 * subscription feed items so the same upload never shows twice. Returns the
 * number of genuinely new items added.
 */
export function ingestRecommended(
	items: {
		videoId: string;
		title: string;
		channelName: string | null;
		channelId: string | null;
		durationSeconds: number | null;
		thumbnailUrl: string | null;
	}[]
): number {
	if (!items.length) return 0;
	const ids = items.map((i) => i.videoId);

	const known = new Set(
		db.select({ v: videos.videoId }).from(videos).where(inArray(videos.videoId, ids)).all().map((r) => r.v)
	);
	// Any existing feed row (subscription OR a prior recommended row) suppresses.
	const existing = new Set(
		db
			.select({ v: feedItems.videoId })
			.from(feedItems)
			.where(inArray(feedItems.videoId, ids))
			.all()
			.map((r) => r.v)
	);

	let added = 0;
	for (const it of items) {
		if (known.has(it.videoId) || existing.has(it.videoId)) continue;
		db.insert(feedItems)
			.values({
				videoId: it.videoId,
				source: 'recommended',
				channelId: it.channelId,
				channelName: it.channelName,
				title: it.title,
				thumbnailUrl: it.thumbnailUrl,
				durationSeconds: it.durationSeconds,
				status: 'new'
			})
			.onConflictDoNothing()
			.run();
		added++;
	}
	return added;
}

/** Fill in a feed item's duration (metadata job). Best-effort. */
export async function fillFeedItemDuration(videoId: string): Promise<void> {
	const item = db
		.select({ id: feedItems.id, duration: feedItems.durationSeconds })
		.from(feedItems)
		.where(eq(feedItems.videoId, videoId))
		.get();
	if (!item || item.duration != null) return;
	const { probe } = await import('./ytdlp');
	const info = await probe(watchUrl(videoId));
	if (info.durationSeconds != null) {
		db.update(feedItems)
			.set({ durationSeconds: info.durationSeconds })
			.where(eq(feedItems.videoId, videoId))
			.run();
	}
}

export function expireOldFeedItems(): number {
	const days = getSetting('feedItemExpiryDays');
	if (days <= 0) return 0;
	const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
	const res = db
		.update(feedItems)
		.set({ status: 'expired' })
		.where(and(eq(feedItems.status, 'new'), lt(feedItems.createdAt, new Date(cutoff))))
		.run();
	return res.changes;
}

/* --------------------------------------------------------------- actions */

export function grabFeedItem(id: number, watchLater = false): void {
	const item = db.select().from(feedItems).where(eq(feedItems.id, id)).get();
	if (!item) return;
	enqueueDownload({
		videoId: item.videoId,
		title: item.title,
		channelId: item.channelId,
		channelName: item.channelName,
		thumbnailUrl: item.thumbnailUrl,
		durationSeconds: item.durationSeconds,
		addToWatchLater: watchLater
	});
	db.update(feedItems).set({ status: 'grabbed' }).where(eq(feedItems.id, id)).run();
}

export function dismissFeedItem(id: number): void {
	db.update(feedItems).set({ status: 'dismissed' }).where(eq(feedItems.id, id)).run();
}

/* --------------------------------------------------------------- queries */

export interface FeedCard {
	id: number;
	videoId: string;
	source: FeedItem['source'];
	channelName: string | null;
	title: string;
	thumbnailUrl: string | null;
	publishedAt: Date | null;
	durationSeconds: number | null;
}

export function listFeed(source?: FeedItem['source']): FeedCard[] {
	const conds = [eq(feedItems.status, 'new')];
	if (source) conds.push(eq(feedItems.source, source));
	return db
		.select({
			id: feedItems.id,
			videoId: feedItems.videoId,
			source: feedItems.source,
			channelName: feedItems.channelName,
			title: feedItems.title,
			thumbnailUrl: feedItems.thumbnailUrl,
			publishedAt: feedItems.publishedAt,
			durationSeconds: feedItems.durationSeconds
		})
		.from(feedItems)
		.where(and(...conds))
		.orderBy(desc(feedItems.publishedAt), desc(feedItems.createdAt))
		.limit(300)
		.all();
}

export function feedCounts(): { total: number } {
	const row = db
		.select({ total: sql<number>`count(*)` })
		.from(feedItems)
		.where(eq(feedItems.status, 'new'))
		.get();
	return { total: row?.total ?? 0 };
}
