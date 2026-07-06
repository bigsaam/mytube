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
	// `private` so a shared proxy (e.g. Cloudflare) can't edge-cache an authed
	// response and serve it without auth. Browser caching still applies.
	return serveFile(abs, request, 'text/vtt; charset=utf-8', { cache: 'private, max-age=86400' });
};
