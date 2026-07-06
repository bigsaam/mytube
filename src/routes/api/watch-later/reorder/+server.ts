import { json, error } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { videos } from '$lib/server/db/schema';
import { isVideoId } from '$lib/server/slug';
import type { RequestHandler } from './$types';

/** Persist a new Watch Later order. Body: { order: [videoId, …] }. */
export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json().catch(() => null)) as { order?: string[] } | null;
	const order = body?.order;
	if (!Array.isArray(order)) error(400, 'Bad request');

	db.transaction((tx) => {
		order.slice(0, 5000).forEach((videoId, i) => {
			if (!isVideoId(videoId)) return;
			tx.update(videos).set({ watchLaterOrder: i }).where(eq(videos.videoId, videoId)).run();
		});
	});
	return json({ ok: true });
};
