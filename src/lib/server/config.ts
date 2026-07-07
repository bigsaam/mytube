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

	// --- Auth ---
	// Auth turns ON as soon as a master token OR a login password is configured.
	// With neither set, the app is open (LAN-only mode, the default).
	authMasterToken: (env.AUTH_TOKEN ?? '').trim() || null,
	authPassword: (env.AUTH_PASSWORD ?? '').trim() || null,
	// Optional explicit cookie-signing secret; otherwise persisted in /data.
	authSecret: (env.AUTH_SECRET ?? '').trim() || null,
	get authEnabled(): boolean {
		return !!(this.authMasterToken || this.authPassword);
	},
	// Secure-cookie flag: on when serving over HTTPS. Override with AUTH_COOKIE_SECURE.
	get cookieSecure(): boolean {
		if (env.AUTH_COOKIE_SECURE != null) return bool(env.AUTH_COOKIE_SECURE, false);
		return this.origin.startsWith('https://');
	},

	// Google OAuth client credentials. Env is the source of truth (render from
	// 1Password); the Settings UI is a fallback that writes them to /data.
	googleClientId: (env.GOOGLE_OAUTH_CLIENT_ID ?? '').trim() || null,
	googleClientSecret: (env.GOOGLE_OAUTH_CLIENT_SECRET ?? '').trim() || null,

	// yt-dlp / cookies
	ytdlpPath: env.YTDLP_PATH ?? 'yt-dlp',
	get cookiesPath() {
		return path.join(this.dataRoot, 'cookies.txt');
	},
	get browserProfileDir() {
		return path.join(this.dataRoot, 'browser-profile');
	}
} as const;
