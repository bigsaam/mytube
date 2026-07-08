import { listFeed } from '$lib/server/feed';
import { db } from '$lib/server/db';
import { channels } from '$lib/server/db/schema';
import { sql } from 'drizzle-orm';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = () => {
	const channelCount = db.select({ n: sql<number>`count(*)` }).from(channels).get()?.n ?? 0;
	// Feed is subscription-only now; recommendations live on /discover.
	return { items: listFeed('subscription'), channelCount };
};
