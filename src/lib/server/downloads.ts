import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from './db';
import { downloads, videos, watchProgress, type Download } from './db/schema';
import { config } from './config';
import { getSettings } from './settings';
import { watchUrl } from './youtube-url';
import {
	probe,
	downloadVideo,
	chaptersFromInfo,
	YtDlpError,
	type RawInfo
} from './ytdlp';
import { videoDirAbs, toRelative, fileSize } from './media';
import { channelSlug } from './slug';
import { fetchSponsorSegments } from './sponsorblock';
import { parseUploadDate } from './ytdlp';
import { bus } from './events';

/**
 * Download queue: DB-backed, restart-safe. The worker loop calls `tick()`;
 * this module owns claiming, running yt-dlp, retrying with backoff, and
 * writing the resulting library row.
 */

const inFlight = new Set<number>();

export interface EnqueueOptions {
	videoId: string;
	title?: string;
	channelId?: string | null;
	channelName?: string | null;
	thumbnailUrl?: string | null;
	durationSeconds?: number | null;
	addToWatchLater?: boolean;
	maxHeight?: number | null;
	priority?: number;
}

export interface EnqueueResult {
	status: 'queued' | 'exists' | 'in_progress';
	videoId: string;
}

/** Queue a download, creating/patching the library row. Idempotent per video. */
export function enqueueDownload(opts: EnqueueOptions): EnqueueResult {
	const { videoId } = opts;
	const url = watchUrl(videoId);

	// Upsert the library row so the UI shows the item immediately.
	const existing = db.select().from(videos).where(eq(videos.videoId, videoId)).get();
	if (!existing) {
		db.insert(videos)
			.values({
				videoId,
				title: opts.title ?? videoId,
				channelId: opts.channelId ?? null,
				channelName: opts.channelName ?? null,
				channelSlug: channelSlug(opts.channelName, opts.channelId),
				durationSeconds: opts.durationSeconds ?? null,
				status: 'pending',
				inWatchLater: !!opts.addToWatchLater,
				watchLaterOrder: opts.addToWatchLater ? nextWatchLaterOrder() : null
			})
			.run();
	} else {
		const patch: Partial<typeof videos.$inferInsert> = {};
		if (opts.addToWatchLater && !existing.inWatchLater) {
			patch.inWatchLater = true;
			patch.watchLaterOrder = nextWatchLaterOrder();
		}
		if (opts.title && existing.title === existing.videoId) patch.title = opts.title;
		if (Object.keys(patch).length) {
			db.update(videos).set(patch).where(eq(videos.videoId, videoId)).run();
		}
		// Already have the files — nothing to download.
		if (existing.status === 'ready' && !existing.filesDeleted) {
			return { status: 'exists', videoId };
		}
	}

	// Don't stack duplicate active/queued jobs for the same video.
	const active = db
		.select({ id: downloads.id })
		.from(downloads)
		.where(and(eq(downloads.videoId, videoId), inArray(downloads.status, ['queued', 'active'])))
		.get();
	if (active) return { status: 'in_progress', videoId };

	db.insert(downloads)
		.values({
			videoId,
			url,
			status: 'queued',
			priority: opts.priority ?? 0,
			addToWatchLater: !!opts.addToWatchLater,
			maxHeight: opts.maxHeight ?? null
		})
		.run();

	bus.emit('download:update', { videoId });
	return { status: 'queued', videoId };
}

function nextWatchLaterOrder(): number {
	const row = db
		.select({ max: sql<number>`coalesce(max(${videos.watchLaterOrder}), 0)` })
		.from(videos)
		.where(eq(videos.inWatchLater, true))
		.get();
	return (row?.max ?? 0) + 1;
}

/** Reset rows left 'active' by a crash back to 'queued'. Call once at boot. */
export function resetStuckDownloads(): void {
	db.update(downloads)
		.set({ status: 'queued', progress: 0, speed: null, eta: null, stage: null })
		.where(eq(downloads.status, 'active'))
		.run();
}

/** One scheduler tick: fill free concurrency slots with queued work. */
export function tick(): void {
	const free = config.maxConcurrentDownloads - inFlight.size;
	if (free <= 0) return;

	const now = new Date();
	const candidates = db
		.select()
		.from(downloads)
		.where(and(eq(downloads.status, 'queued'), sql`${downloads.runAfter} <= ${now.getTime()}`))
		.orderBy(sql`${downloads.priority} desc, ${downloads.createdAt} asc`)
		.limit(free)
		.all();

	for (const dl of candidates) {
		if (inFlight.has(dl.id)) continue;
		claim(dl);
		inFlight.add(dl.id);
		// Fire and forget; the loop keeps ticking.
		process(dl.id).finally(() => {
			inFlight.delete(dl.id);
		});
	}
}

function claim(dl: Download): void {
	db.update(downloads)
		.set({ status: 'active', startedAt: new Date(), progress: 0, error: null })
		.where(eq(downloads.id, dl.id))
		.run();
	db.update(videos)
		.set({ status: 'downloading' })
		.where(and(eq(videos.videoId, dl.videoId), inArray(videos.status, ['pending', 'failed'])))
		.run();
	bus.emit('download:update', { id: dl.id, videoId: dl.videoId });
}

async function process(id: number): Promise<void> {
	const dl = db.select().from(downloads).where(eq(downloads.id, id)).get();
	if (!dl) return;
	const settings = getSettings();

	try {
		// 1) Probe for channel + title so we can name the directory and show info.
		let info: RawInfo | null = null;
		const p = await probe(dl.url);
		const channelId = p.channelId;
		db.update(videos)
			.set({
				title: p.title,
				channelId: p.channelId,
				channelName: p.channelName,
				channelSlug: channelSlug(p.channelName, p.channelId),
				durationSeconds: p.durationSeconds,
				description: p.description,
				uploadDate: p.uploadDate
			})
			.where(eq(videos.videoId, dl.videoId))
			.run();

		// 2) Download into /media/{slug}/{video_id}/video.*
		const targetDir = videoDirAbs(p.channelName, channelId, dl.videoId);
		let lastWrittenPct = -1;
		const result = await downloadVideo({
			url: dl.url,
			targetDir,
			maxHeight: dl.maxHeight ?? settings.defaultMaxHeight,
			preferH264: settings.preferH264,
			onProgress: (prog) => {
				if (Math.abs(prog.percent - lastWrittenPct) < 0.005 && prog.stage === dl.stage) return;
				lastWrittenPct = prog.percent;
				db.update(downloads)
					.set({ progress: prog.percent, speed: prog.speed, eta: prog.eta, stage: prog.stage })
					.where(eq(downloads.id, id))
					.run();
				bus.emit('download:update', { id, videoId: dl.videoId, ...prog });
			}
		});
		info = result.info;

		if (!result.videoPath) {
			throw new YtDlpError('download finished but no video file was produced', '', 0);
		}

		// 3) SponsorBlock (best-effort).
		const sponsorblock = settings.sponsorblockEnabled
			? await fetchSponsorSegments(dl.videoId, settings.sponsorblockCategories)
			: [];

		// 4) Persist the finished library row.
		db.update(videos)
			.set({
				title: info?.title ?? p.title,
				description: info?.description ?? p.description,
				channelName: info?.channel ?? info?.uploader ?? p.channelName,
				channelId: info?.channel_id ?? channelId,
				durationSeconds: info?.duration ?? p.durationSeconds,
				uploadDate: parseUploadDate(info?.upload_date) ?? p.uploadDate,
				videoPath: toRelative(result.videoPath),
				thumbnailPath: result.thumbnailPath ? toRelative(result.thumbnailPath) : null,
				subtitlePath: result.subtitlePath ? toRelative(result.subtitlePath) : null,
				infoJsonPath: result.infoJsonPath ? toRelative(result.infoJsonPath) : null,
				width: info?.width ?? null,
				height: info?.height ?? null,
				container: 'mp4',
				filesizeBytes: fileSize(result.videoPath),
				chapters: chaptersFromInfo(info),
				sponsorblock,
				status: 'ready',
				filesDeleted: false,
				downloadedAt: new Date()
			})
			.where(eq(videos.videoId, dl.videoId))
			.run();

		db.update(downloads)
			.set({ status: 'done', progress: 1, speed: null, eta: null, finishedAt: new Date() })
			.where(eq(downloads.id, id))
			.run();

		bus.emit('download:update', { id, videoId: dl.videoId, done: true });
	} catch (err) {
		handleFailure(dl, err);
	}
}

function handleFailure(dl: Download, err: unknown): void {
	const tail = err instanceof YtDlpError ? err.tail || err.message : String(err);
	const attempts = dl.attempts + 1;

	if (attempts < dl.maxAttempts) {
		// Exponential backoff with jitter: 30s, ~60s, ~120s …
		const base = 30_000 * 2 ** (attempts - 1);
		const jitter = Math.floor(base * 0.25 * deterministicJitter(dl.id, attempts));
		const runAfter = new Date(Date.now() + base + jitter);
		db.update(downloads)
			.set({ status: 'queued', attempts, error: tail.slice(-4000), runAfter, progress: 0 })
			.where(eq(downloads.id, dl.id))
			.run();
	} else {
		db.update(downloads)
			.set({ status: 'failed', attempts, error: tail.slice(-4000), finishedAt: new Date() })
			.where(eq(downloads.id, dl.id))
			.run();
		db.update(videos)
			.set({ status: 'failed' })
			.where(and(eq(videos.videoId, dl.videoId), eq(videos.status, 'downloading')))
			.run();
	}
	bus.emit('download:update', { id: dl.id, videoId: dl.videoId, error: true });
}

/** Requeue a failed download for another 3 attempts. */
export function retryDownload(id: number): void {
	db.update(downloads)
		.set({ status: 'queued', attempts: 0, error: null, runAfter: new Date(), progress: 0 })
		.where(and(eq(downloads.id, id), eq(downloads.status, 'failed')))
		.run();
	const dl = db.select().from(downloads).where(eq(downloads.id, id)).get();
	if (dl) {
		db.update(videos)
			.set({ status: 'pending' })
			.where(and(eq(videos.videoId, dl.videoId), eq(videos.status, 'failed')))
			.run();
	}
	bus.emit('download:update', { id });
}

// Cheap non-random jitter so behavior is reproducible per (id, attempt).
function deterministicJitter(id: number, attempt: number): number {
	const x = Math.sin(id * 12.9898 + attempt * 78.233) * 43758.5453;
	return x - Math.floor(x);
}

/** Reset watch progress when files are (re)downloaded. */
export function clearWatchProgress(videoId: string): void {
	db.delete(watchProgress).where(eq(watchProgress.videoId, videoId)).run();
}
