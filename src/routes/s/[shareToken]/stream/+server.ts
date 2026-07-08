import { error } from '@sveltejs/kit';
import { verifyShare } from '$lib/server/shares';
import { serveVideo } from '$lib/server/media-serve';
import type { RequestHandler } from './$types';

const handler: RequestHandler = ({ params, request }) => {
	const share = verifyShare(params.shareToken);
	if (!share) error(404, 'Not found');
	return serveVideo(share.videoId, request);
};

export const GET = handler;
export const HEAD = handler;
