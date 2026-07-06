import { and, eq, sql } from 'drizzle-orm';
import { db } from './db';
import { videos } from './db/schema';

/**
 * Storage accounting for the dashboard. Sizes come from the stored
 * `filesize_bytes` (fast, no disk walk) — accurate because we record the real
 * file size at download time and null it on cleanup.
 */

export interface StorageSummary {
	totalBytes: number;
	videoCount: number;
	watchedReclaimableBytes: number;
	watchedReclaimableCount: number;
	perChannel: { channelId: string | null; channelName: string | null; bytes: number; count: number }[];
}

export function storageSummary(): StorageSummary {
	const present = and(eq(videos.filesDeleted, false), eq(videos.status, 'ready'));

	const totals = db
		.select({
			bytes: sql<number>`coalesce(sum(${videos.filesizeBytes}), 0)`,
			count: sql<number>`count(*)`
		})
		.from(videos)
		.where(present)
		.get();

	const reclaim = db
		.select({
			bytes: sql<number>`coalesce(sum(${videos.filesizeBytes}), 0)`,
			count: sql<number>`count(*)`
		})
		.from(videos)
		.where(and(present, eq(videos.watched, true), eq(videos.pinned, false)))
		.get();

	const perChannel = db
		.select({
			channelId: videos.channelId,
			channelName: videos.channelName,
			bytes: sql<number>`coalesce(sum(${videos.filesizeBytes}), 0)`,
			count: sql<number>`count(*)`
		})
		.from(videos)
		.where(present)
		.groupBy(videos.channelId, videos.channelName)
		.orderBy(sql`sum(${videos.filesizeBytes}) desc`)
		.all();

	return {
		totalBytes: totals?.bytes ?? 0,
		videoCount: totals?.count ?? 0,
		watchedReclaimableBytes: reclaim?.bytes ?? 0,
		watchedReclaimableCount: reclaim?.count ?? 0,
		perChannel
	};
}
