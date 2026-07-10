import { json, error } from '@sveltejs/kit';
import { listRecommendations, grabRecommendation, dismissRecommendation } from '$lib/server/discover';
import type { RequestHandler } from './$types';

/** Paginated pool read for the Discover "load more" (id cursor via ?before=). */
export const GET: RequestHandler = ({ url }) => {
	const before = Number(url.searchParams.get('before')) || undefined;
	const limit = Number(url.searchParams.get('limit')) || 48;
	return json({ items: listRecommendations({ beforeId: before, limit }) });
};

/** Discover card actions: grab / watchLater / watchNow / dismiss. */
export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json().catch(() => null)) as {
		id?: number;
		action?: 'grab' | 'watchLater' | 'watchNow' | 'dismiss';
	} | null;
	const id = Number(body?.id);
	if (!Number.isFinite(id) || !body?.action) error(400, 'Bad request');

	switch (body.action) {
		case 'grab':
			grabRecommendation(id);
			break;
		case 'watchLater':
			grabRecommendation(id, { watchLater: true });
			break;
		// Stream-and-discard: download it, hand the client the id to navigate to,
		// and let the cleanup sweep prune it once watched (unless the user Keeps it).
		case 'watchNow': {
			const videoId = grabRecommendation(id, { ephemeral: true });
			if (!videoId) error(404, 'No such recommendation');
			return json({ ok: true, videoId });
		}
		case 'dismiss':
			dismissRecommendation(id);
			break;
		default:
			error(400, 'Unknown action');
	}
	return json({ ok: true });
};
