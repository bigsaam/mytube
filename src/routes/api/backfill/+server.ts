import { json } from '@sveltejs/kit';
import { enqueueBackfillAll } from '$lib/server/backfill';
import type { RequestHandler } from './$types';

/**
 * Queue a stats + comments backfill for every ready video. Authed like the rest
 * of `/api/*`; safe to re-run (jobs dedupe per video). Meant to be triggered
 * once after upgrading — from the Settings button or by an operator/agent:
 *   curl -X POST -H "Authorization: Bearer $TOKEN" "$ORIGIN/api/backfill"
 */
export const POST: RequestHandler = () => {
	const enqueued = enqueueBackfillAll();
	return json({ enqueued });
};
