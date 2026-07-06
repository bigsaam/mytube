import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { settings } from '$lib/server/db/schema';
import { config } from '$lib/server/config';

/**
 * Typed application settings. Defaults live here; the DB stores only overrides.
 * Env vars seed a few defaults but the DB value wins once set via the UI.
 */
export interface AppSettings {
	// Downloads
	defaultMaxHeight: number;
	preferH264: boolean;

	// Lifecycle / cleanup
	cleanupPolicy: 'keep_forever' | 'delete_after_days' | 'delete_immediately';
	cleanupKeepDays: number;
	autoMarkWatchedPercent: number;

	// SponsorBlock
	sponsorblockEnabled: boolean;
	sponsorblockAutoSkip: boolean;
	sponsorblockCategories: string[];
	// 'remove' physically cuts segments at download (needs ffmpeg); 'skip'
	// keeps the file intact and skips client-side in the player.
	sponsorblockMode: 'skip' | 'remove';

	// YouTube playlist sync (Data API). Reads a dedicated playlist, auto-grabs
	// new items, and removes them once watched. Secrets/tokens live in a file
	// (see google-auth.ts) — never in settings — so they can't reach the client.
	playlistSyncEnabled: boolean;
	syncPlaylistId: string | null;
	syncPlaylistTitle: string | null;

	// Feed / scheduler
	rssPollIntervalMin: number;
	feedItemExpiryDays: number;

	// Recommended feed (optional module)
	recommendedFilterShorts: boolean;
	recommendedFilterMixes: boolean;
	recommendedFilterLive: boolean;
	recommendedPollsPerDay: number;
	// Health state surfaced as a Settings banner.
	recommendedStatus: 'ok' | 'needs_attention' | 'never_run';
	recommendedMessage: string;

	// History sync jitter window (minutes)
	historySyncMinDelayMin: number;
	historySyncMaxDelayMin: number;

	// Cookies presence flag (the file itself lives at config.cookiesPath)
	cookiesUploadedAt: number | null;
}

export const DEFAULT_SETTINGS: AppSettings = {
	defaultMaxHeight: config.defaultMaxHeight,
	preferH264: true,

	cleanupPolicy: 'keep_forever',
	cleanupKeepDays: 30,
	autoMarkWatchedPercent: 90,

	sponsorblockEnabled: true,
	sponsorblockAutoSkip: true,
	sponsorblockCategories: ['sponsor', 'selfpromo', 'interaction', 'intro', 'outro', 'music_offtopic'],
	sponsorblockMode: 'remove',

	playlistSyncEnabled: false,
	syncPlaylistId: null,
	syncPlaylistTitle: null,

	rssPollIntervalMin: config.rssPollIntervalMin,
	feedItemExpiryDays: config.feedItemExpiryDays,

	recommendedFilterShorts: true,
	recommendedFilterMixes: true,
	recommendedFilterLive: true,
	recommendedPollsPerDay: 3,
	recommendedStatus: 'never_run',
	recommendedMessage: '',

	historySyncMinDelayMin: 1,
	historySyncMaxDelayMin: 15,

	cookiesUploadedAt: null
};

/** In-process cache so hot paths (worker loop) don't hit SQLite constantly. */
let cache: AppSettings | null = null;

export function getSettings(): AppSettings {
	if (cache) return cache;
	const rows = db.select().from(settings).all();
	const overrides: Partial<AppSettings> = {};
	for (const row of rows) {
		if (row.key in DEFAULT_SETTINGS) {
			(overrides as Record<string, unknown>)[row.key] = row.value;
		}
	}
	cache = { ...DEFAULT_SETTINGS, ...overrides };
	return cache;
}

export function getSetting<K extends keyof AppSettings>(key: K): AppSettings[K] {
	return getSettings()[key];
}

export function setSetting<K extends keyof AppSettings>(key: K, value: AppSettings[K]): void {
	db.insert(settings)
		.values({ key, value: value as unknown, updatedAt: new Date() })
		.onConflictDoUpdate({ target: settings.key, set: { value: value as unknown, updatedAt: new Date() } })
		.run();
	cache = null; // invalidate
}

export function updateSettings(patch: Partial<AppSettings>): AppSettings {
	for (const [key, value] of Object.entries(patch)) {
		if (key in DEFAULT_SETTINGS) {
			setSetting(key as keyof AppSettings, value as never);
		}
	}
	return getSettings();
}

export function invalidateSettingsCache() {
	cache = null;
}
