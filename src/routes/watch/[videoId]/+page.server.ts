import { error, fail } from '@sveltejs/kit';
import { eq, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { videos } from '$lib/server/db/schema';
import { getVideo } from '$lib/server/library';
import { markWatched, markUnwatched } from '$lib/server/lifecycle';
import { enqueueDownload } from '$lib/server/downloads';
import { getSetting } from '$lib/server/settings';
import { config } from '$lib/server/config';
import { isVideoId } from '$lib/server/slug';
import { createShare, revokeShare, listSharesForVideo } from '$lib/server/shares';
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
		return {
			playable: false as const,
			video: { ...common, status: video.status, cleaned: video.filesDeleted }
		};
	}
	return {
		playable: true as const,
		autoSkipDefault: getSetting('sponsorblockAutoSkip'),
		historySyncEnabled: config.historySyncEnabled,
		authEnabled: config.authEnabled,
		shareOrigin: config.origin,
		shares: listSharesForVideo(video.videoId),
		video: {
			...common,
			hasSubtitles: !!video.subtitlePath,
			chapters: video.chapters ?? [],
			sponsorblock: video.sponsorblock ?? [],
			positionSeconds: video.positionSeconds,
			viewCount: video.viewCount,
			likeCount: video.likeCount,
			commentCount: video.commentCount,
			comments: video.comments ?? []
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
	},

	createShare: async ({ request }) => {
		const form = await request.formData();
		const videoId = id(form);
		const raw = String(form.get('expiresInDays') ?? '30');
		const expiresInDays = raw === 'never' ? null : Number(raw) || 30;
		const label = String(form.get('label') ?? '');
		const { token } = createShare(videoId, { expiresInDays, label });
		// Plaintext token returned once so the page can show the full link.
		return { shareToken: token };
	},

	revokeShare: async ({ request }) => {
		const form = await request.formData();
		const shareId = Number(form.get('shareId'));
		if (Number.isFinite(shareId)) revokeShare(shareId);
		return { ok: true };
	},

	regrab: async ({ request }) => {
		const form = await request.formData();
		const videoId = id(form);
		const row = db.select().from(videos).where(eq(videos.videoId, videoId)).get();
		if (row) {
			enqueueDownload({
				videoId,
				title: row.title,
				channelId: row.channelId,
				channelName: row.channelName,
				durationSeconds: row.durationSeconds
			});
			db.update(videos).set({ status: 'pending', filesDeleted: false }).where(eq(videos.videoId, videoId)).run();
		}
		return { ok: true };
	}
};
