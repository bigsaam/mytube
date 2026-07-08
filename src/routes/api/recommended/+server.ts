import { json, error } from '@sveltejs/kit';
import { listRecommendations, grabRecommendation, dismissRecommendation } from '$lib/server/discover';
import type { RequestHandler } from './$types';

/** Paginated pool read for the Discover "load more" (id cursor via ?before=). */
export const GET: RequestHandler = ({ url }) => {
	const before = Number(url.searchParams.get('before')) || undefined;
	const limit = Number(url.searchParams.get('limit')) || 48;
	return json({ items: listRecommendations({ beforeId: before, limit }) });
};

/** Discover card actions: grab / watchLater / dismiss. */
export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json().catch(() => null)) as {
		id?: number;
		action?: 'grab' | 'watchLater' | 'dismiss';
	} | null;
	const id = Number(body?.id);
	if (!Number.isFinite(id) || !body?.action) error(400, 'Bad request');

	switch (body.action) {
		case 'grab':
			grabRecommendation(id, false);
			break;
		case 'watchLater':
			grabRecommendation(id, true);
			break;
		case 'dismiss':
			dismissRecommendation(id);
			break;
		default:
			error(400, 'Unknown action');
	}
	return json({ ok: true });
};
