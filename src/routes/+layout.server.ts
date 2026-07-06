import { sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { feedItems, videos, downloads } from '$lib/server/db/schema';
import type { LayoutServerLoad } from './$types';

/** Lightweight counts for the sidebar badges. */
export const load: LayoutServerLoad = ({ locals }) => {
	const feed = db
		.select({ n: sql<number>`count(*)` })
		.from(feedItems)
		.where(sql`${feedItems.status} = 'new'`)
		.get();
	const wl = db
		.select({ n: sql<number>`count(*)` })
		.from(videos)
		.where(sql`${videos.inWatchLater} = 1`)
		.get();
	const active = db
		.select({ n: sql<number>`count(*)` })
		.from(downloads)
		.where(sql`${downloads.status} in ('active','queued')`)
		.get();

	return {
		authEnabled: locals.authEnabled,
		counts: {
			feed: feed?.n ?? 0,
			watchLater: wl?.n ?? 0,
			downloads: active?.n ?? 0
		}
	};
};
