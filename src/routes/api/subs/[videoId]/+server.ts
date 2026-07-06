import { error } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { videos } from '$lib/server/db/schema';
import { toAbsolute } from '$lib/server/media';
import { serveFile } from '$lib/server/serve';
import { isVideoId } from '$lib/server/slug';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ params, request }) => {
	if (!isVideoId(params.videoId)) error(400, 'Bad video id');
	const row = db
		.select({ subtitlePath: videos.subtitlePath })
		.from(videos)
		.where(eq(videos.videoId, params.videoId))
		.get();
	const abs = toAbsolute(row?.subtitlePath);
	if (!abs) error(404, 'No subtitles');
	return serveFile(abs, request, 'text/vtt; charset=utf-8', { cache: 'public, max-age=86400' });
};
