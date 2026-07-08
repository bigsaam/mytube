import path from 'node:path';
import { and, eq, isNotNull } from 'drizzle-orm';
import { db } from './db';
import { videos } from './db/schema';
import { getSettings } from './settings';
import { refetchInfo, chaptersFromInfo, commentsFromInfo } from './ytdlp';
import { toAbsolute } from './media';
import { watchUrl } from './youtube-url';
import { enqueueJob } from './jobs';

/**
 * Backfill engagement stats + comments for videos downloaded before those
 * fields existed. Old info.json files were written without comments, so this
 * does a metadata-only `yt-dlp --skip-download` refetch (no re-download) per
 * video, run in the background via the `backfill_metadata` job.
 */

/** Queue a backfill for every ready, on-disk video. Returns how many enqueued. */
export function enqueueBackfillAll(): number {
	const rows = db
		.select({ videoId: videos.videoId })
		.from(videos)
		.where(and(eq(videos.status, 'ready'), eq(videos.filesDeleted, false), isNotNull(videos.videoPath)))
		.all();
	for (const r of rows) {
		enqueueJob('backfill_metadata', { videoId: r.videoId }, { dedupeKey: `backfill:${r.videoId}` });
	}
	return rows.length;
}

/** Refresh one video's stats + comments (+ chapters) from a metadata refetch. */
export async function backfillVideo(videoId: string): Promise<void> {
	const row = db.select().from(videos).where(eq(videos.videoId, videoId)).get();
	if (!row || row.filesDeleted || !row.videoPath) return;
	const abs = toAbsolute(row.videoPath);
	if (!abs) return;

	const info = await refetchInfo({
		url: watchUrl(videoId),
		targetDir: path.dirname(abs),
		fetchComments: getSettings().fetchComments
	});
	if (!info) return;

	db.update(videos)
		.set({
			viewCount: info.view_count ?? row.viewCount,
			likeCount: info.like_count ?? row.likeCount,
			commentCount: info.comment_count ?? row.commentCount,
			comments: commentsFromInfo(info) ?? row.comments,
			chapters: chaptersFromInfo(info) ?? row.chapters
		})
		.where(eq(videos.videoId, videoId))
		.run();
}
