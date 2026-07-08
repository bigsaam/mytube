import { error } from '@sveltejs/kit';
import { verifyShare } from '$lib/server/shares';
import { serveSubs } from '$lib/server/media-serve';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ params, request }) => {
	const share = verifyShare(params.shareToken);
	if (!share) error(404, 'Not found');
	return serveSubs(share.videoId, request);
};
