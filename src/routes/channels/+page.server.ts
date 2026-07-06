import { fail } from '@sveltejs/kit';
import {
	addChannelFromInput,
	importTakeoutCsv,
	setAutoGrab,
	removeChannel,
	listChannels
} from '$lib/server/channels';
import { enqueueJob } from '$lib/server/jobs';
import type { PageServerLoad, Actions } from './$types';

export const load: PageServerLoad = () => {
	return { channels: listChannels() };
};

export const actions: Actions = {
	add: async ({ request }) => {
		const form = await request.formData();
		const input = String(form.get('input') ?? '').trim();
		if (!input) return fail(400, { error: 'Enter a channel URL, handle, or video link.' });
		try {
			const result = await addChannelFromInput(input);
			if (result.status === 'unresolved') {
				return fail(422, { error: "Couldn't resolve that to a channel." });
			}
			return { added: result.status === 'added', name: result.channel?.name, exists: result.status === 'exists' };
		} catch (err) {
			return fail(500, { error: err instanceof Error ? err.message : 'Failed to add channel' });
		}
	},

	importCsv: async ({ request }) => {
		const form = await request.formData();
		const file = form.get('csv');
		if (!(file instanceof File) || file.size === 0) {
			return fail(400, { error: 'Choose a subscriptions.csv file.' });
		}
		const text = await file.text();
		const { added, total } = await importTakeoutCsv(text);
		return { imported: added, total };
	},

	toggleAutoGrab: async ({ request }) => {
		const form = await request.formData();
		const id = String(form.get('id') ?? '');
		const on = form.get('on') === '1';
		if (id) setAutoGrab(id, on);
		return { ok: true };
	},

	pollNow: async ({ request }) => {
		const form = await request.formData();
		const id = String(form.get('id') ?? '');
		if (id) enqueueJob('rss_poll', { channelId: id }, { dedupeKey: `rss:${id}` });
		return { ok: true };
	},

	remove: async ({ request }) => {
		const form = await request.formData();
		const id = String(form.get('id') ?? '');
		if (id) removeChannel(id);
		return { ok: true };
	}
};
