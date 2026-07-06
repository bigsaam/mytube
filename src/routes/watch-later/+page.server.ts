import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { videos } from '$lib/server/db/schema';
import { listLibrary } from '$lib/server/library';
import { isVideoId } from '$lib/server/slug';
import type { PageServerLoad, Actions } from './$types';

export const load: PageServerLoad = () => {
	return { items: listLibrary({ watchLater: true }) };
};

export const actions: Actions = {
	remove: async ({ request }) => {
		const form = await request.formData();
		const videoId = String(form.get('videoId') ?? '');
		if (isVideoId(videoId)) {
			db.update(videos)
				.set({ inWatchLater: false, watchLaterOrder: null })
				.where(eq(videos.videoId, videoId))
				.run();
		}
		return { ok: true };
	}
};
