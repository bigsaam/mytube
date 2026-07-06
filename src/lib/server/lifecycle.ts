import { eq } from 'drizzle-orm';
import { db } from './db';
import { videos } from './db/schema';

/**
 * Watched lifecycle. Marking watched removes the video from Watch Later. The
 * cleanup policies and the optional YouTube history-sync hook attach here in
 * later phases (see the extension points below).
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
	watchedHook?.(videoId);
}
