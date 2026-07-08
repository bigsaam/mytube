import { error } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from './db';
import { videos } from './db/schema';
import { toAbsolute } from './media';
import { serveFile } from './serve';

/**
 * Media response builders keyed by a already-resolved `videoId`. Shared by the
 * authed `/api/{stream,thumb,subs}` routes and the public `/s/…` share routes
 * so the file-resolution + range-serving logic lives in exactly one place.
 *
 * These throw SvelteKit `error()` on miss, which any endpoint handler catches.
 * Cache is `private` throughout: behind a shared proxy (e.g. Cloudflare) a
 * public response could be edge-cached and served after a token is revoked.
 */

export function serveVideo(videoId: string, request: Request): Response {
	const row = db
		.select({ videoPath: videos.videoPath, filesDeleted: videos.filesDeleted })
		.from(videos)
		.where(eq(videos.videoId, videoId))
		.get();
	if (!row) error(404, 'Unknown video');
	if (row.filesDeleted) error(410, 'Files were cleaned up');
	const abs = toAbsolute(row.videoPath);
	if (!abs) error(404, 'No file');
	return serveFile(abs, request, 'video/mp4', { cache: 'private, max-age=0' });
}

export function serveThumb(videoId: string, request: Request): Response {
	const row = db
		.select({ thumbnailPath: videos.thumbnailPath })
		.from(videos)
		.where(eq(videos.videoId, videoId))
		.get();
	const abs = toAbsolute(row?.thumbnailPath);
	if (!abs) error(404, 'No thumbnail');
	const ext = abs.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
	return serveFile(abs, request, ext, { cache: 'private, max-age=86400' });
}

export function serveSubs(videoId: string, request: Request): Response {
	const row = db
		.select({ subtitlePath: videos.subtitlePath })
		.from(videos)
		.where(eq(videos.videoId, videoId))
		.get();
	const abs = toAbsolute(row?.subtitlePath);
	if (!abs) error(404, 'No subtitles');
	return serveFile(abs, request, 'text/vtt; charset=utf-8', { cache: 'private, max-age=86400' });
}
