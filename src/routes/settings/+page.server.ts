import { fail } from '@sveltejs/kit';
import { getSettings, updateSettings, type AppSettings } from '$lib/server/settings';
import { storageSummary } from '$lib/server/storage';
import { cleanupAllWatched } from '$lib/server/lifecycle';
import { getVersion, selfUpdate } from '$lib/server/ytdlp';
import { authStatus } from '$lib/server/google-auth';
import { listApiTokens, createApiToken, revokeApiToken } from '$lib/server/auth';
import { listSharesWithVideo, revokeShare } from '$lib/server/shares';
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

export const load: PageServerLoad = async ({ locals }) => {
	const ytdlpVersion = await getVersion().catch(() => null);
	return {
		settings: getSettings(),
		storage: storageSummary(),
		ytdlpVersion,
		sbCategories: SB_CATEGORIES,
		youtube: authStatus(),
		authEnabled: locals.authEnabled,
		apiTokens: locals.authEnabled ? listApiTokens() : [],
		shares: listSharesWithVideo(),
		shareOrigin: config.origin,
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
			fetchComments: bool(form, 'fetchComments'),
			cleanupPolicy: (String(form.get('cleanupPolicy')) as AppSettings['cleanupPolicy']) || cur.cleanupPolicy,
			cleanupKeepDays: num(form, 'cleanupKeepDays', cur.cleanupKeepDays),
			playlistRemoveOnDownload: bool(form, 'playlistRemoveOnDownload'),
			cleanupPlaylistWatched: bool(form, 'cleanupPlaylistWatched'),
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
	},

	createToken: async ({ request, locals }) => {
		if (!locals.authEnabled) return fail(400, { error: 'Auth is disabled.' });
		const form = await request.formData();
		const name = String(form.get('name') ?? '').trim() || 'device';
		const { token, row } = createApiToken(name);
		// Plaintext is returned exactly once, for the user to copy now.
		return { newToken: token, newTokenName: row.name };
	},

	revokeToken: async ({ request, locals }) => {
		if (!locals.authEnabled) return fail(400, { error: 'Auth is disabled.' });
		const form = await request.formData();
		const id = Number(form.get('id'));
		if (Number.isFinite(id)) revokeApiToken(id);
		return { revoked: true };
	},

	revokeShare: async ({ request }) => {
		const form = await request.formData();
		const id = Number(form.get('id'));
		if (Number.isFinite(id)) revokeShare(id);
		return { revoked: true };
	}
};
