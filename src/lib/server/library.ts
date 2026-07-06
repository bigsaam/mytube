import { and, desc, eq, like, or, sql, inArray, asc } from 'drizzle-orm';
import { db } from './db';
import { videos, watchProgress, downloads, type Video } from './db/schema';

/** Full library row plus resume position (for the player + progress bars). */
export function getVideo(videoId: string): (Video & { positionSeconds: number }) | null {
	const row = db
		.select()
		.from(videos)
		.leftJoin(watchProgress, eq(watchProgress.videoId, videos.videoId))
		.where(eq(videos.videoId, videoId))
		.get();
	if (!row) return null;
	return { ...row.videos, positionSeconds: row.watch_progress?.positionSeconds ?? 0 };
}

export interface LibraryCard {
	videoId: string;
	title: string;
	channelName: string | null;
	channelId: string | null;
	durationSeconds: number | null;
	status: Video['status'];
	watched: boolean;
	filesDeleted: boolean;
	progress: number; // 0..1 resume
	addedAt: Date;
}

export interface LibraryFilter {
	search?: string;
	channelId?: string;
	watchLater?: boolean;
	includeUnwatchedOnly?: boolean;
}

export function listLibrary(filter: LibraryFilter = {}): LibraryCard[] {
	const conds = [inArray(videos.status, ['ready', 'downloading', 'pending', 'failed'] as const)];
	if (filter.channelId) conds.push(eq(videos.channelId, filter.channelId));
	if (filter.watchLater) conds.push(eq(videos.inWatchLater, true));
	if (filter.includeUnwatchedOnly) conds.push(eq(videos.watched, false));
	if (filter.search) {
		const q = `%${filter.search.toLowerCase()}%`;
		conds.push(
			or(
				like(sql`lower(${videos.title})`, q),
				like(sql`lower(coalesce(${videos.channelName}, ''))`, q),
				like(sql`lower(coalesce(${videos.description}, ''))`, q)
			)!
		);
	}

	const order = filter.watchLater
		? [asc(videos.watchLaterOrder)]
		: [desc(videos.downloadedAt), desc(videos.addedAt)];

	const rows = db
		.select({
			videoId: videos.videoId,
			title: videos.title,
			channelName: videos.channelName,
			channelId: videos.channelId,
			durationSeconds: videos.durationSeconds,
			status: videos.status,
			watched: videos.watched,
			filesDeleted: videos.filesDeleted,
			addedAt: videos.addedAt,
			position: watchProgress.positionSeconds
		})
		.from(videos)
		.leftJoin(watchProgress, eq(watchProgress.videoId, videos.videoId))
		.where(and(...conds))
		.orderBy(...order)
		.all();

	return rows.map((r) => ({
		videoId: r.videoId,
		title: r.title,
		channelName: r.channelName,
		channelId: r.channelId,
		durationSeconds: r.durationSeconds,
		status: r.status,
		watched: r.watched,
		filesDeleted: r.filesDeleted,
		addedAt: r.addedAt,
		progress:
			r.durationSeconds && r.position ? Math.min(1, r.position / r.durationSeconds) : 0
	}));
}

export interface DownloadRow {
	id: number;
	videoId: string;
	title: string;
	status: (typeof downloads.$inferSelect)['status'];
	progress: number;
	speed: string | null;
	eta: string | null;
	stage: string | null;
	attempts: number;
	maxAttempts: number;
	error: string | null;
	createdAt: Date;
}

export function listDownloads(): DownloadRow[] {
	const rows = db
		.select({
			id: downloads.id,
			videoId: downloads.videoId,
			title: videos.title,
			status: downloads.status,
			progress: downloads.progress,
			speed: downloads.speed,
			eta: downloads.eta,
			stage: downloads.stage,
			attempts: downloads.attempts,
			maxAttempts: downloads.maxAttempts,
			error: downloads.error,
			createdAt: downloads.createdAt
		})
		.from(downloads)
		.leftJoin(videos, eq(videos.videoId, downloads.videoId))
		.orderBy(
			sql`case ${downloads.status} when 'active' then 0 when 'queued' then 1 when 'failed' then 2 else 3 end`,
			desc(downloads.createdAt)
		)
		.limit(200)
		.all();
	return rows.map((r) => ({ ...r, title: r.title ?? r.videoId }));
}
