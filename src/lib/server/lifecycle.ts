import { and, eq, isNotNull, lt } from 'drizzle-orm';
import { db } from './db';
import { videos } from './db/schema';
import { deleteVideoDir } from './media';
import { getSettings } from './settings';

/**
 * Watched lifecycle + cleanup policies. Marking watched removes the video from
 * Watch Later and (per policy) may schedule its files for deletion. Deleting
 * files keeps the DB row as history (filesDeleted=true) so the video can be
 * re-grabbed later.
 */

export interface MarkWatchedOptions {
	/** True when triggered by the ≥90% auto-mark rather than a manual toggle. */
	auto?: boolean;
}

export function markWatched(videoId: string, _opts: MarkWatchedOptions = {}): void {
	const existing = db
		.select({ watched: videos.watched })
		.from(videos)
		.where(eq(videos.videoId, videoId))
		.get();
	if (!existing || existing.watched) return;

	db.update(videos)
		.set({
			watched: true,
			watchedAt: new Date(),
			// Marking watched removes it from the Watch Later queue.
			inWatchLater: false,
			watchLaterOrder: null
		})
		.where(eq(videos.videoId, videoId))
		.run();

	// Phase 6 extension point: if HISTORY_SYNC_ENABLED and not opted out, enqueue
	// a jittered `history_sync` job here.
	onWatched(videoId);
}

export function markUnwatched(videoId: string): void {
	db.update(videos)
		.set({ watched: false, watchedAt: null })
		.where(eq(videos.videoId, videoId))
		.run();
}

/** Overridable hook so later phases can react to a watched event. */
let watchedHook: ((videoId: string) => void) | null = null;
export function setWatchedHook(fn: (videoId: string) => void): void {
	watchedHook = fn;
}
function onWatched(videoId: string): void {
	// Immediate-delete policy prunes as soon as something is watched.
	if (getSettings().cleanupPolicy === 'delete_immediately') {
		deleteFiles(videoId);
	}
	watchedHook?.(videoId);
}

/* --------------------------------------------------------------- cleanup */

/** Delete a video's files but keep the DB row as history. Respects pins. */
export function deleteFiles(videoId: string): boolean {
	const row = db
		.select({ videoPath: videos.videoPath, pinned: videos.pinned, filesDeleted: videos.filesDeleted })
		.from(videos)
		.where(eq(videos.videoId, videoId))
		.get();
	if (!row || row.pinned || row.filesDeleted) return false;
	deleteVideoDir(row.videoPath);
	db.update(videos)
		.set({ filesDeleted: true, videoPath: null, thumbnailPath: null, subtitlePath: null, infoJsonPath: null, filesizeBytes: null })
		.where(eq(videos.videoId, videoId))
		.run();
	return true;
}

/**
 * Run the configured cleanup policy. Returns how many videos were pruned.
 * - keep_forever      → no-op
 * - delete_immediately→ any watched, unpinned, still-present video
 * - delete_after_days → watched longer than N days ago
 */
export function runCleanupSweep(): number {
	const s = getSettings();
	if (s.cleanupPolicy === 'keep_forever') return 0;

	const conds = [
		eq(videos.watched, true),
		eq(videos.pinned, false),
		eq(videos.filesDeleted, false),
		isNotNull(videos.videoPath)
	];
	if (s.cleanupPolicy === 'delete_after_days') {
		const cutoff = Date.now() - s.cleanupKeepDays * 24 * 60 * 60 * 1000;
		conds.push(lt(videos.watchedAt, new Date(cutoff)));
	}
	const targets = db
		.select({ videoId: videos.videoId })
		.from(videos)
		.where(and(...conds))
		.all();

	let pruned = 0;
	for (const t of targets) if (deleteFiles(t.videoId)) pruned++;
	return pruned;
}

/** One-click "clean up all watched now" from the storage dashboard. */
export function cleanupAllWatched(): number {
	const targets = db
		.select({ videoId: videos.videoId })
		.from(videos)
		.where(
			and(
				eq(videos.watched, true),
				eq(videos.pinned, false),
				eq(videos.filesDeleted, false),
				isNotNull(videos.videoPath)
			)
		)
		.all();
	let pruned = 0;
	for (const t of targets) if (deleteFiles(t.videoId)) pruned++;
	return pruned;
}
