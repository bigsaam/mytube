import fs from 'node:fs';
import { and, desc, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import { db } from './db';
import { recommendations, videos, jobs, type Recommendation } from './db/schema';
import { enqueueDownload } from './downloads';
import { enqueueJob } from './jobs';
import { config } from './config';

/**
 * The "Discover" recommendation pool. Scraped items (see recommended-scraper.ts)
 * are ingested here; the Discover page browses the pool and Grab/Dismiss act on
 * it. Kept separate from feed.ts so the Feed stays subscription-only.
 */

export interface IngestOptions {
	source?: Recommendation['source']; // 'home' (default) | 'upnext'
	sourceVideoId?: string | null; // provenance for up-next
}

export interface IngestItem {
	videoId: string;
	title: string;
	channelName: string | null;
	channelId: string | null;
	durationSeconds: number | null;
	thumbnailUrl: string | null;
	badges?: string[];
}

/**
 * Ingest recommended items in ranked order (input order = YouTube's ranking).
 * Deduped against the library (already have it) and against the existing pool
 * (unique videoId). Returns the count of genuinely new rows.
 */
export function ingestRecommended(items: IngestItem[], opts: IngestOptions = {}): number {
	if (!items.length) return 0;
	const ids = items.map((i) => i.videoId);

	const inLibrary = new Set(
		db.select({ v: videos.videoId }).from(videos).where(inArray(videos.videoId, ids)).all().map((r) => r.v)
	);
	const inPool = new Set(
		db.select({ v: recommendations.videoId }).from(recommendations).where(inArray(recommendations.videoId, ids)).all().map((r) => r.v)
	);

	let added = 0;
	items.forEach((it, rank) => {
		if (inLibrary.has(it.videoId) || inPool.has(it.videoId)) return;
		db.insert(recommendations)
			.values({
				videoId: it.videoId,
				title: it.title,
				channelName: it.channelName,
				channelId: it.channelId,
				thumbnailUrl: it.thumbnailUrl,
				durationSeconds: it.durationSeconds,
				badges: it.badges ?? null,
				source: opts.source ?? 'home',
				sourceVideoId: opts.sourceVideoId ?? null,
				rank
			})
			.onConflictDoNothing()
			.run();
		added++;
	});
	return added;
}

export interface DiscoverCard {
	id: number;
	videoId: string;
	title: string;
	channelName: string | null;
	thumbnailUrl: string | null;
	durationSeconds: number | null;
	source: Recommendation['source'];
}

/**
 * A page of the pool: newest first, only still-actionable ('new') items. Uses an
 * id cursor (`beforeId`) rather than offset so pagination stays stable as items
 * are grabbed/dismissed out of the pool. id is monotonic with insertion order.
 */
export function listRecommendations(opts: { limit?: number; beforeId?: number } = {}): DiscoverCard[] {
	const limit = Math.min(100, Math.max(1, opts.limit ?? 48));
	const conds = [eq(recommendations.status, 'new')];
	if (opts.beforeId && opts.beforeId > 0) conds.push(lt(recommendations.id, opts.beforeId));
	return db
		.select({
			id: recommendations.id,
			videoId: recommendations.videoId,
			title: recommendations.title,
			channelName: recommendations.channelName,
			thumbnailUrl: recommendations.thumbnailUrl,
			durationSeconds: recommendations.durationSeconds,
			source: recommendations.source
		})
		.from(recommendations)
		.where(and(...conds))
		.orderBy(desc(recommendations.id))
		.limit(limit)
		.all();
}

/** Unread-style count for the Discover sidebar badge. */
export function countNewRecommendations(): number {
	return (
		db
			.select({ n: sql<number>`count(*)` })
			.from(recommendations)
			.where(eq(recommendations.status, 'new'))
			.get()?.n ?? 0
	);
}

/** Grab (download) a pooled recommendation, optionally into Watch Later. */
export interface GrabOptions {
	watchLater?: boolean;
	/** Stream-and-discard: pruned once watched, unless the user hits Keep. */
	ephemeral?: boolean;
}

/**
 * Pull a pooled recommendation into the library. Returns the videoId so callers
 * (e.g. "Watch now") can navigate straight to `/watch/<id>`, which already
 * renders the still-downloading state.
 */
export function grabRecommendation(id: number, opts: GrabOptions = {}): string | null {
	const rec = db.select().from(recommendations).where(eq(recommendations.id, id)).get();
	if (!rec) return null;
	enqueueDownload({
		videoId: rec.videoId,
		title: rec.title,
		channelId: rec.channelId,
		channelName: rec.channelName,
		thumbnailUrl: rec.thumbnailUrl,
		durationSeconds: rec.durationSeconds,
		addToWatchLater: !!opts.watchLater,
		ephemeral: !!opts.ephemeral
	});
	db.update(recommendations).set({ status: 'downloaded' }).where(eq(recommendations.id, id)).run();
	return rec.videoId;
}

export function dismissRecommendation(id: number): void {
	db.update(recommendations).set({ status: 'dismissed' }).where(eq(recommendations.id, id)).run();
}

/* ------------------------------------------------------- on-demand refresh */

// Manual refreshes are rate-capped so "endless" never becomes "hammering YT".
const MANUAL_MIN_INTERVAL_MS = 5 * 60 * 1000;

export interface RefreshResult {
	status: 'queued' | 'rate_limited' | 'disabled' | 'no_cookies';
	message: string;
	retryAfterSec?: number;
}

/**
 * Queue an on-demand recommended-feed scrape, gated on the feature flag +
 * cookies and rate-limited vs. the last scrape (scheduled or manual). Enqueues
 * with the same dedupe key the scheduler uses, so it coalesces with a pending
 * scheduled scrape.
 */
export function requestManualScrape(): RefreshResult {
	if (!config.recommendedFeedEnabled) {
		return { status: 'disabled', message: 'The recommended feed is disabled.' };
	}
	if (!fs.existsSync(config.cookiesPath)) {
		return { status: 'no_cookies', message: 'Upload your YouTube cookies first (Settings → Recommended feed).' };
	}
	const last = db
		.select({ createdAt: jobs.createdAt })
		.from(jobs)
		.where(eq(jobs.type, 'recommended_scrape'))
		.orderBy(desc(jobs.createdAt))
		.limit(1)
		.get();
	if (last) {
		const elapsed = Date.now() - last.createdAt.getTime();
		if (elapsed < MANUAL_MIN_INTERVAL_MS) {
			return {
				status: 'rate_limited',
				message: 'Just refreshed — give it a few minutes before trying again.',
				retryAfterSec: Math.ceil((MANUAL_MIN_INTERVAL_MS - elapsed) / 1000)
			};
		}
	}
	enqueueJob('recommended_scrape', {}, { dedupeKey: 'recommended_scrape' });
	return { status: 'queued', message: 'Fetching fresh recommendations — they’ll appear in a moment.' };
}

/** Up-next scrapes are triggered by watching, so they need a global budget. */
const UPNEXT_MAX_PER_HOUR = 6;

/**
 * Queue an up-next scrape seeded by `videoId` (the rabbit hole). Triggered from
 * the watched hook, so it is capped twice over:
 *
 *  - per video: a `upnext:<id>` dedupe key, and we skip videos we already
 *    harvested (an existing `upnext` row naming it as source);
 *  - globally: at most UPNEXT_MAX_PER_HOUR jobs an hour, because a binge session
 *    would otherwise fire one scrape per video watched.
 *
 * More scrape surface means more drift and more cookie burn — see the handoff.
 */
export function requestUpnextScrape(videoId: string): RefreshResult {
	if (!config.recommendedFeedEnabled) {
		return { status: 'disabled', message: 'The recommended feed is disabled.' };
	}
	if (!fs.existsSync(config.cookiesPath)) {
		return { status: 'no_cookies', message: 'Upload your YouTube cookies first.' };
	}

	// Already mined this video? Its related rail barely moves; don't re-scrape.
	const harvested = db
		.select({ id: recommendations.id })
		.from(recommendations)
		.where(and(eq(recommendations.source, 'upnext'), eq(recommendations.sourceVideoId, videoId)))
		.limit(1)
		.get();
	if (harvested) {
		return { status: 'rate_limited', message: 'Already pulled recommendations from this video.' };
	}

	const since = new Date(Date.now() - 60 * 60 * 1000);
	const recent = db
		.select({ n: sql<number>`count(*)` })
		.from(jobs)
		.where(and(eq(jobs.type, 'upnext_scrape'), gte(jobs.createdAt, since)))
		.get();
	if ((recent?.n ?? 0) >= UPNEXT_MAX_PER_HOUR) {
		return { status: 'rate_limited', message: 'Up-next scrape budget for this hour is used up.' };
	}

	enqueueJob('upnext_scrape', { videoId }, { dedupeKey: `upnext:${videoId}` });
	return { status: 'queued', message: 'Pulling more like this.' };
}
