import { fail, redirect } from '@sveltejs/kit';
import fs from 'node:fs';
import { config } from '$lib/server/config';
import { getSettings, updateSettings, setSetting } from '$lib/server/settings';
import { enqueueJob } from '$lib/server/jobs';
import type { PageServerLoad, Actions } from './$types';

export const load: PageServerLoad = () => {
	// This page only makes sense when the module is compiled in.
	if (!config.recommendedFeedEnabled && !config.historySyncEnabled) {
		redirect(307, '/settings');
	}
	return {
		settings: getSettings(),
		flags: {
			recommendedFeedEnabled: config.recommendedFeedEnabled,
			historySyncEnabled: config.historySyncEnabled
		},
		cookiesPresent: fs.existsSync(config.cookiesPath)
	};
};

export const actions: Actions = {
	uploadCookies: async ({ request }) => {
		const form = await request.formData();
		const file = form.get('cookies');
		if (!(file instanceof File) || file.size === 0) {
			return fail(400, { error: 'Choose your exported cookies.txt file.' });
		}
		const text = await file.text();
		if (!/youtube\.com/i.test(text)) {
			console.warn(`[cookies] rejected upload (${file.size}B): no youtube.com entries`);
			return fail(422, { error: "That doesn't look like a YouTube cookies.txt export." });
		}
		fs.mkdirSync(config.dataRoot, { recursive: true });
		fs.writeFileSync(config.cookiesPath, text, { mode: 0o600 });
		// The app logs no HTTP requests, so without this an upload that never
		// arrives is indistinguishable from one that silently failed to persist.
		console.log(`[cookies] saved ${text.length}B → ${config.cookiesPath}`);
		setSetting('cookiesUploadedAt', Date.now());
		// A fresh cookie file clears any "needs attention" state.
		setSetting('recommendedStatus', 'ok');
		setSetting('recommendedMessage', 'Cookies uploaded. Waiting for the next scrape.');
		return { cookiesSaved: true };
	},

	removeCookies: async () => {
		if (fs.existsSync(config.cookiesPath)) fs.rmSync(config.cookiesPath);
		setSetting('cookiesUploadedAt', null);
		return { cookiesRemoved: true };
	},

	saveRecommended: async ({ request }) => {
		const form = await request.formData();
		updateSettings({
			recommendedFilterShorts: form.get('filterShorts') != null,
			recommendedFilterMixes: form.get('filterMixes') != null,
			recommendedFilterLive: form.get('filterLive') != null,
			recommendedPollsPerDay: Math.min(4, Math.max(2, Number(form.get('pollsPerDay')) || 3))
		});
		return { saved: true };
	},

	scrapeNow: async () => {
		if (!config.recommendedFeedEnabled) return fail(400, { error: 'Recommended feed is disabled.' });
		if (!fs.existsSync(config.cookiesPath)) return fail(400, { error: 'Upload cookies first.' });
		enqueueJob('recommended_scrape', {}, { dedupeKey: 'recommended_scrape' });
		return { scraping: true };
	}
};
