import { fail } from '@sveltejs/kit';
import { listDownloads } from '$lib/server/library';
import { retryDownload } from '$lib/server/downloads';
import type { PageServerLoad, Actions } from './$types';

export const load: PageServerLoad = () => {
	return { downloads: listDownloads() };
};

export const actions: Actions = {
	retry: async ({ request }) => {
		const form = await request.formData();
		const id = Number(form.get('id'));
		if (!Number.isFinite(id)) return fail(400, { error: 'bad id' });
		retryDownload(id);
		return { ok: true };
	}
};
