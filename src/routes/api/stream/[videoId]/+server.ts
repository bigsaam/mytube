import { error } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { videos } from '$lib/server/db/schema';
import { toAbsolute } from '$lib/server/media';
import { serveFile } from '$lib/server/serve';
import { isVideoId } from '$lib/server/slug';
import type { RequestHandler } from './$types';

const handler: RequestHandler = ({ params, request }) => {
	if (!isVideoId(params.videoId)) error(400, 'Bad video id');
	const row = db
		.select({ videoPath: videos.videoPath, filesDeleted: videos.filesDeleted })
		.from(videos)
		.where(eq(videos.videoId, params.videoId))
		.get();
	if (!row) error(404, 'Unknown video');
	if (row.filesDeleted) error(410, 'Files were cleaned up');
	const abs = toAbsolute(row.videoPath);
	if (!abs) error(404, 'No file');
	return serveFile(abs, request, 'video/mp4', { cache: 'private, max-age=0' });
};

export const GET = handler;
export const HEAD = handler;
