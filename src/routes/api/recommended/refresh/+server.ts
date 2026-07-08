import { json } from '@sveltejs/kit';
import { requestManualScrape } from '$lib/server/discover';
import type { RequestHandler } from './$types';

/** On-demand recommended-feed scrape (rate-capped). Authed like all /api/*. */
export const POST: RequestHandler = () => json(requestManualScrape());
