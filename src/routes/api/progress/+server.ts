import { json, error } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { watchProgress, videos } from '$lib/server/db/schema';
import { isVideoId } from '$lib/server/slug';
import { getSetting } from '$lib/server/settings';
import { markWatched } from '$lib/server/lifecycle';
import type { RequestHandler } from './$types';

/**
 * Persist playback position (pinged ~every 5s). When a video crosses the
 * auto-watched threshold we mark it watched (which also handles Watch Later
 * removal + optional history sync — see lifecycle.ts).
 */
export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json().catch(() => null)) as {
		videoId?: string;
		position?: number;
		duration?: number;
	} | null;
	if (!body || !body.videoId || !isVideoId(body.videoId)) error(400, 'Bad request');

	const position = Math.max(0, Number(body.position) || 0);
	const duration = body.duration && body.duration > 0 ? Number(body.duration) : null;

	db.insert(watchProgress)
		.values({ videoId: body.videoId, positionSeconds: position, durationSeconds: duration, updatedAt: new Date() })
		.onConflictDoUpdate({
			target: watchProgress.videoId,
			set: { positionSeconds: position, durationSeconds: duration, updatedAt: new Date() }
		})
		.run();

	// Auto-mark watched at the configured threshold.
	let watched = false;
	if (duration && duration > 0) {
		const threshold = getSetting('autoMarkWatchedPercent') / 100;
		if (position / duration >= threshold) {
			const row = db
				.select({ watched: videos.watched })
				.from(videos)
				.where(eq(videos.videoId, body.videoId))
				.get();
			if (row && !row.watched) {
				markWatched(body.videoId, { auto: true });
			}
			watched = true;
		}
	}

	return json({ ok: true, watched });
};
