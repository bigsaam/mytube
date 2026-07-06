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
		.select({ thumbnailPath: videos.thumbnailPath })
		.from(videos)
		.where(eq(videos.videoId, params.videoId))
		.get();
	const abs = toAbsolute(row?.thumbnailPath);
	if (!abs) error(404, 'No thumbnail');
	const ext = abs.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
	return serveFile(abs, request, ext, { cache: 'public, max-age=86400' });
};
