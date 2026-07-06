import { env } from '$env/dynamic/private';
import path from 'node:path';

/**
 * Centralized runtime configuration derived from environment variables.
 * Env vars are read once at startup. User-tunable behavior (poll intervals,
 * quality, cleanup policy) lives in the `settings` table instead — see
 * $lib/server/settings.ts.
 */

function bool(v: string | undefined, fallback: boolean): boolean {
	if (v == null) return fallback;
	return /^(1|true|yes|on)$/i.test(v.trim());
}

function int(v: string | undefined, fallback: number): number {
	const n = Number.parseInt(v ?? '', 10);
	return Number.isFinite(n) ? n : fallback;
}

export const config = {
	databasePath: env.DATABASE_PATH ?? path.resolve('data/mytube.db'),
	mediaRoot: path.resolve(env.MEDIA_ROOT ?? 'media'),
	dataRoot: path.resolve(env.DATA_ROOT ?? 'data'),
	origin: env.ORIGIN ?? 'http://localhost:3000',

	defaultMaxHeight: int(env.DEFAULT_MAX_HEIGHT, 1080),
	maxConcurrentDownloads: int(env.MAX_CONCURRENT_DOWNLOADS, 2),

	rssPollIntervalMin: int(env.RSS_POLL_INTERVAL_MIN, 30),
	feedItemExpiryDays: int(env.FEED_ITEM_EXPIRY_DAYS, 30),

	recommendedFeedEnabled: bool(env.RECOMMENDED_FEED_ENABLED, false),
	historySyncEnabled: bool(env.HISTORY_SYNC_ENABLED, false),

	// yt-dlp / cookies
	ytdlpPath: env.YTDLP_PATH ?? 'yt-dlp',
	get cookiesPath() {
		return path.join(this.dataRoot, 'cookies.txt');
	},
	get browserProfileDir() {
		return path.join(this.dataRoot, 'browser-profile');
	}
} as const;
