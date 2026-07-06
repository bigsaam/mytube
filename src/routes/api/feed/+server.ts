import { json, error } from '@sveltejs/kit';
import { grabFeedItem, dismissFeedItem } from '$lib/server/feed';
import type { RequestHandler } from './$types';

/** Feed item actions: grab / watchLater / dismiss. */
export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json().catch(() => null)) as {
		id?: number;
		action?: 'grab' | 'watchLater' | 'dismiss';
	} | null;
	const id = Number(body?.id);
	if (!Number.isFinite(id) || !body?.action) error(400, 'Bad request');

	switch (body.action) {
		case 'grab':
			grabFeedItem(id, false);
			break;
		case 'watchLater':
			grabFeedItem(id, true);
			break;
		case 'dismiss':
			dismissFeedItem(id);
			break;
		default:
			error(400, 'Unknown action');
	}
	return json({ ok: true });
};
