import { fail } from '@sveltejs/kit';
import { getSettings, updateSettings, type AppSettings } from '$lib/server/settings';
import { storageSummary } from '$lib/server/storage';
import { cleanupAllWatched } from '$lib/server/lifecycle';
import { getVersion, selfUpdate } from '$lib/server/ytdlp';
import { authStatus } from '$lib/server/google-auth';
import { config } from '$lib/server/config';
import type { PageServerLoad, Actions } from './$types';

const SB_CATEGORIES = [
	'sponsor',
	'selfpromo',
	'interaction',
	'intro',
	'outro',
	'preview',
	'music_offtopic',
	'filler'
];

export const load: PageServerLoad = async () => {
	const ytdlpVersion = await getVersion().catch(() => null);
	return {
		settings: getSettings(),
		storage: storageSummary(),
		ytdlpVersion,
		sbCategories: SB_CATEGORIES,
		youtube: authStatus(),
		flags: {
			recommendedFeedEnabled: config.recommendedFeedEnabled,
			historySyncEnabled: config.historySyncEnabled
		}
	};
};

function num(form: FormData, key: string, fallback: number): number {
	const n = Number(form.get(key));
	return Number.isFinite(n) ? n : fallback;
}
function bool(form: FormData, key: string): boolean {
	return form.get(key) === 'on' || form.get(key) === '1' || form.get(key) === 'true';
}

export const actions: Actions = {
	save: async ({ request }) => {
		const form = await request.formData();
		const cur = getSettings();
		const patch: Partial<AppSettings> = {
			defaultMaxHeight: num(form, 'defaultMaxHeight', cur.defaultMaxHeight),
			preferH264: bool(form, 'preferH264'),
			cleanupPolicy: (String(form.get('cleanupPolicy')) as AppSettings['cleanupPolicy']) || cur.cleanupPolicy,
			cleanupKeepDays: num(form, 'cleanupKeepDays', cur.cleanupKeepDays),
			autoMarkWatchedPercent: Math.min(100, Math.max(50, num(form, 'autoMarkWatchedPercent', cur.autoMarkWatchedPercent))),
			sponsorblockEnabled: bool(form, 'sponsorblockEnabled'),
			sponsorblockAutoSkip: bool(form, 'sponsorblockAutoSkip'),
			sponsorblockMode: form.get('sponsorblockMode') === 'skip' ? 'skip' : 'remove',
			sponsorblockCategories: SB_CATEGORIES.filter((c) => form.get(`sb_${c}`) != null),
			rssPollIntervalMin: Math.max(5, num(form, 'rssPollIntervalMin', cur.rssPollIntervalMin)),
			feedItemExpiryDays: Math.max(0, num(form, 'feedItemExpiryDays', cur.feedItemExpiryDays))
		};
		updateSettings(patch);
		return { saved: true };
	},

	updateYtdlp: async () => {
		try {
			const version = await selfUpdate();
			return { ytdlpUpdated: true, version };
		} catch (err) {
			return fail(500, { error: err instanceof Error ? err.message : 'yt-dlp update failed' });
		}
	},

	cleanupNow: async () => {
		const pruned = cleanupAllWatched();
		return { cleaned: pruned };
	}
};
