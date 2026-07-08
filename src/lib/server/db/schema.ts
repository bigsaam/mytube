import { sql } from 'drizzle-orm';
import { sqliteTable, text, integer, real, index, uniqueIndex } from 'drizzle-orm/sqlite-core';

/**
 * Schema notes
 * ------------
 * - `video_id` (YouTube's 11-char id) is the canonical key everywhere. Numeric
 *   surrogate PKs exist only for ergonomics; joins/dedup happen on `video_id`.
 * - All timestamps are stored as integer unix-millis (UTC). Display is localized
 *   in the UI layer only.
 * - JSON columns hold structured, rarely-queried blobs (chapters, sponsorblock,
 *   job payloads, badges).
 */

const now = sql`(unixepoch() * 1000)`;

/* ------------------------------------------------------------------ channels */
export const channels = sqliteTable('channels', {
	// YouTube channel id, e.g. UCxxxxxxxxxxxxxxxxxxxxxx
	id: text('id').primaryKey(),
	name: text('name').notNull(),
	handle: text('handle'),
	url: text('url').notNull(),
	avatarUrl: text('avatar_url'),
	// When true, every new upload is auto-queued for download.
	autoGrab: integer('auto_grab', { mode: 'boolean' }).notNull().default(false),
	addedAt: integer('added_at', { mode: 'timestamp_ms' }).notNull().default(now),
	lastPolledAt: integer('last_polled_at', { mode: 'timestamp_ms' })
});

/* --------------------------------------------------------------- feed_items */
// A surfaced upload the user can Grab / Watch Later / Dismiss. Sourced from
// subscription RSS or the (optional) recommended-feed scraper.
export const feedItems = sqliteTable(
	'feed_items',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		videoId: text('video_id').notNull(),
		source: text('source', { enum: ['subscription', 'recommended'] })
			.notNull()
			.default('subscription'),
		channelId: text('channel_id'),
		channelName: text('channel_name'),
		title: text('title').notNull(),
		thumbnailUrl: text('thumbnail_url'),
		publishedAt: integer('published_at', { mode: 'timestamp_ms' }),
		// Duration is not in RSS; lazily filled by a metadata job. null = unknown.
		durationSeconds: integer('duration_seconds'),
		// 'new' | 'grabbed' | 'dismissed' | 'expired'
		status: text('status', { enum: ['new', 'grabbed', 'dismissed', 'expired'] })
			.notNull()
			.default('new'),
		// Recommended-feed classification badges: live / members / shorts / mix.
		badges: text('badges', { mode: 'json' }).$type<string[]>(),
		createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(now)
	},
	(t) => ({
		// One feed row per (video, source). A video can legitimately appear from
		// both a subscription and the recommended feed.
		uqVideoSource: uniqueIndex('uq_feed_video_source').on(t.videoId, t.source),
		byStatus: index('idx_feed_status').on(t.status),
		byPublished: index('idx_feed_published').on(t.publishedAt)
	})
);

/* ------------------------------------------------------------------- videos */
// The library. A row exists as soon as a download is requested; files land later.
export const videos = sqliteTable(
	'videos',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		videoId: text('video_id').notNull().unique(),
		title: text('title').notNull(),
		description: text('description'),
		channelId: text('channel_id'),
		channelName: text('channel_name'),
		channelSlug: text('channel_slug'),
		durationSeconds: integer('duration_seconds'),
		// YouTube upload date as unix-millis (parsed from info.json's YYYYMMDD).
		uploadDate: integer('upload_date', { mode: 'timestamp_ms' }),

		// Relative paths under MEDIA_ROOT (null until the file exists).
		videoPath: text('video_path'),
		thumbnailPath: text('thumbnail_path'),
		subtitlePath: text('subtitle_path'),
		infoJsonPath: text('info_json_path'),

		width: integer('width'),
		height: integer('height'),
		container: text('container'),
		filesizeBytes: integer('filesize_bytes'),

		chapters: text('chapters', { mode: 'json' }).$type<Chapter[]>(),
		sponsorblock: text('sponsorblock', { mode: 'json' }).$type<SponsorSegment[]>(),

		// Lifecycle
		// 'pending' -> 'downloading' -> 'ready' | 'failed'; 'deleted' = files pruned.
		status: text('status', {
			enum: ['pending', 'downloading', 'ready', 'failed', 'deleted']
		})
			.notNull()
			.default('pending'),
		watched: integer('watched', { mode: 'boolean' }).notNull().default(false),
		watchedAt: integer('watched_at', { mode: 'timestamp_ms' }),
		inWatchLater: integer('in_watch_later', { mode: 'boolean' }).notNull().default(false),
		watchLaterOrder: integer('watch_later_order'),
		// Exempt from cleanup policies when true.
		pinned: integer('pinned', { mode: 'boolean' }).notNull().default(false),
		// Files removed by cleanup but the record is kept as history.
		filesDeleted: integer('files_deleted', { mode: 'boolean' }).notNull().default(false),
		// "Mark watched locally only" — never enqueue a history_sync for this video.
		historySyncOptout: integer('history_sync_optout', { mode: 'boolean' })
			.notNull()
			.default(false),
		// Origin of this download, when it came from a synced YouTube playlist.
		// `playlistItemId` is the Data API id we DELETE to remove it from the
		// playlist once watched (null = not sourced from a synced playlist).
		sourcePlaylistId: text('source_playlist_id'),
		playlistItemId: text('playlist_item_id'),

		addedAt: integer('added_at', { mode: 'timestamp_ms' }).notNull().default(now),
		downloadedAt: integer('downloaded_at', { mode: 'timestamp_ms' })
	},
	(t) => ({
		byChannel: index('idx_videos_channel').on(t.channelId),
		byStatus: index('idx_videos_status').on(t.status),
		byWatchLater: index('idx_videos_wl').on(t.inWatchLater, t.watchLaterOrder),
		byAdded: index('idx_videos_added').on(t.addedAt)
	})
);

/* ---------------------------------------------------------------- downloads */
// The download queue. Worked by the background worker; drives the Downloads page.
export const downloads = sqliteTable(
	'downloads',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		videoId: text('video_id').notNull(),
		url: text('url').notNull(),
		// 'queued' | 'active' | 'done' | 'failed' | 'canceled'
		status: text('status', {
			enum: ['queued', 'active', 'done', 'failed', 'canceled']
		})
			.notNull()
			.default('queued'),
		priority: integer('priority').notNull().default(0),
		attempts: integer('attempts').notNull().default(0),
		maxAttempts: integer('max_attempts').notNull().default(3),
		// Backoff / scheduling gate: worker ignores rows until now >= runAfter.
		runAfter: integer('run_after', { mode: 'timestamp_ms' }).notNull().default(now),

		// Live progress (parsed from yt-dlp stdout).
		progress: real('progress').notNull().default(0), // 0..1
		speed: text('speed'),
		eta: text('eta'),
		stage: text('stage'), // video | audio | merge | subs | thumb | metadata | sponsorblock
		error: text('error'), // tail of last failure

		// Post-download intent.
		addToWatchLater: integer('add_to_watch_later', { mode: 'boolean' })
			.notNull()
			.default(false),
		maxHeight: integer('max_height'), // per-download override; null = use global

		createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(now),
		startedAt: integer('started_at', { mode: 'timestamp_ms' }),
		finishedAt: integer('finished_at', { mode: 'timestamp_ms' })
	},
	(t) => ({
		byStatus: index('idx_downloads_status').on(t.status),
		byRunAfter: index('idx_downloads_runafter').on(t.runAfter)
	})
);

/* ------------------------------------------------------------------- jobs */
// Generic background work that isn't a download: RSS polls, lazy metadata,
// recommended scrapes, history sync pings, cleanup sweeps, feed expiry.
export const jobs = sqliteTable(
	'jobs',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		type: text('type', {
			enum: [
				'metadata',
				'rss_poll',
				'recommended_scrape',
				'history_sync',
				'cleanup',
				'expire_feed',
				'playlist_sync',
				'playlist_remove'
			]
		}).notNull(),
		payload: text('payload', { mode: 'json' }).$type<Record<string, unknown>>(),
		status: text('status', { enum: ['queued', 'active', 'done', 'failed'] })
			.notNull()
			.default('queued'),
		priority: integer('priority').notNull().default(0),
		attempts: integer('attempts').notNull().default(0),
		maxAttempts: integer('max_attempts').notNull().default(3),
		runAfter: integer('run_after', { mode: 'timestamp_ms' }).notNull().default(now),
		error: text('error'),
		// Optional idempotency key to avoid piling up duplicate jobs.
		dedupeKey: text('dedupe_key'),
		createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(now),
		startedAt: integer('started_at', { mode: 'timestamp_ms' }),
		finishedAt: integer('finished_at', { mode: 'timestamp_ms' })
	},
	(t) => ({
		byStatus: index('idx_jobs_status').on(t.status),
		byRunAfter: index('idx_jobs_runafter').on(t.runAfter),
		uqDedupe: uniqueIndex('uq_jobs_dedupe').on(t.dedupeKey)
	})
);

/* ---------------------------------------------------------- watch_progress */
export const watchProgress = sqliteTable('watch_progress', {
	videoId: text('video_id').primaryKey(),
	positionSeconds: real('position_seconds').notNull().default(0),
	durationSeconds: real('duration_seconds'),
	updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().default(now)
});

/* ---------------------------------------------------------------- api_tokens */
// Revocable bearer tokens for programmatic clients (native app, iOS Shortcuts,
// bookmarklet). Only the SHA-256 hash is stored — the plaintext is shown once
// at creation. The env master token (AUTH_TOKEN) is separate and not stored here.
export const apiTokens = sqliteTable('api_tokens', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	name: text('name').notNull(),
	tokenHash: text('token_hash').notNull().unique(),
	tokenPrefix: text('token_prefix').notNull(), // e.g. "mt_ab12cd" for display
	revoked: integer('revoked', { mode: 'boolean' }).notNull().default(false),
	createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(now),
	lastUsedAt: integer('last_used_at', { mode: 'timestamp_ms' })
});

/* -------------------------------------------------------------------- shares */
// Per-video public share links. A share grants unauthenticated read access to
// exactly ONE video's stream/thumb/subs via the `/s/` routes — never the rest
// of the app. The token is stored hashed (sha256), like `api_tokens`, and is
// deliberately NOT accepted by the normal bearer-auth path.
export const shares = sqliteTable(
	'shares',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		videoId: text('video_id').notNull(),
		tokenHash: text('token_hash').notNull().unique(),
		tokenPrefix: text('token_prefix').notNull(), // e.g. "mts_ab12cd" for display
		label: text('label'), // optional note, e.g. "for Alice"
		expiresAt: integer('expires_at', { mode: 'timestamp_ms' }), // null = never
		revoked: integer('revoked', { mode: 'boolean' }).notNull().default(false),
		viewCount: integer('view_count').notNull().default(0),
		createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(now),
		lastUsedAt: integer('last_used_at', { mode: 'timestamp_ms' })
	},
	(t) => ({
		byVideo: index('idx_shares_video').on(t.videoId)
	})
);

/* ------------------------------------------------------------------ settings */
// Simple typed key/value store. Values are JSON-encoded text.
export const settings = sqliteTable('settings', {
	key: text('key').primaryKey(),
	value: text('value', { mode: 'json' }),
	updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().default(now)
});

/* -------------------------------------------------------------------- types */
export interface Chapter {
	title: string;
	startTime: number; // seconds
	endTime?: number;
}

export interface SponsorSegment {
	category: string; // sponsor, selfpromo, interaction, intro, outro, ...
	start: number; // seconds
	end: number;
	uuid?: string;
}

export type Channel = typeof channels.$inferSelect;
export type FeedItem = typeof feedItems.$inferSelect;
export type Video = typeof videos.$inferSelect;
export type Download = typeof downloads.$inferSelect;
export type Job = typeof jobs.$inferSelect;
export type WatchProgress = typeof watchProgress.$inferSelect;
export type Setting = typeof settings.$inferSelect;
export type ApiToken = typeof apiTokens.$inferSelect;
export type Share = typeof shares.$inferSelect;
