import { error, fail } from '@sveltejs/kit';
import { eq, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { videos } from '$lib/server/db/schema';
import { getVideo } from '$lib/server/library';
import { markWatched, markUnwatched } from '$lib/server/lifecycle';
import { getSetting } from '$lib/server/settings';
import { isVideoId } from '$lib/server/slug';
import type { PageServerLoad, Actions } from './$types';

export const load: PageServerLoad = ({ params }) => {
	if (!isVideoId(params.videoId)) error(400, 'Bad video id');
	const video = getVideo(params.videoId);
	if (!video) error(404, 'Video not found');

	const common = {
		videoId: video.videoId,
		title: video.title,
		description: video.description,
		channelName: video.channelName,
		channelId: video.channelId,
		durationSeconds: video.durationSeconds,
		uploadDate: video.uploadDate,
		watched: video.watched,
		inWatchLater: video.inWatchLater,
		pinned: video.pinned,
		historySyncOptout: video.historySyncOptout
	};

	if (video.status !== 'ready' || video.filesDeleted) {
		return { playable: false as const, video: { ...common, status: video.status } };
	}
	return {
		playable: true as const,
		autoSkipDefault: getSetting('sponsorblockAutoSkip'),
		video: {
			...common,
			hasSubtitles: !!video.subtitlePath,
			chapters: video.chapters ?? [],
			sponsorblock: video.sponsorblock ?? [],
			positionSeconds: video.positionSeconds
		}
	};
};

function id(form: FormData): string {
	const v = String(form.get('videoId') ?? '');
	if (!isVideoId(v)) throw fail(400, { error: 'bad id' });
	return v;
}

export const actions: Actions = {
	watched: async ({ request }) => {
		const form = await request.formData();
		markWatched(id(form));
		return { ok: true };
	},
	unwatched: async ({ request }) => {
		const form = await request.formData();
		markUnwatched(id(form));
		return { ok: true };
	},
	watchLater: async ({ request }) => {
		const form = await request.formData();
		const videoId = id(form);
		const add = form.get('add') === '1';
		if (add) {
			const max = db
				.select({ m: sql<number>`coalesce(max(${videos.watchLaterOrder}),0)` })
				.from(videos)
				.where(eq(videos.inWatchLater, true))
				.get();
			db.update(videos)
				.set({ inWatchLater: true, watchLaterOrder: (max?.m ?? 0) + 1 })
				.where(eq(videos.videoId, videoId))
				.run();
		} else {
			db.update(videos)
				.set({ inWatchLater: false, watchLaterOrder: null })
				.where(eq(videos.videoId, videoId))
				.run();
		}
		return { ok: true };
	},
	pin: async ({ request }) => {
		const form = await request.formData();
		const videoId = id(form);
		const pinned = form.get('pinned') === '1';
		db.update(videos).set({ pinned }).where(eq(videos.videoId, videoId)).run();
		return { ok: true };
	},
	historyOptout: async ({ request }) => {
		const form = await request.formData();
		const videoId = id(form);
		const optout = form.get('optout') === '1';
		db.update(videos).set({ historySyncOptout: optout }).where(eq(videos.videoId, videoId)).run();
		return { ok: true };
	}
};
