import { redirect, error } from '@sveltejs/kit';
import { getAuthUrl } from '$lib/server/google-auth';
import type { RequestHandler } from './$types';

/** Kick off the Google OAuth consent flow. */
export const GET: RequestHandler = ({ cookies }) => {
	const state = crypto.randomUUID();
	cookies.set('g_oauth_state', state, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		maxAge: 600
	});
	let url: string;
	try {
		url = getAuthUrl(state);
	} catch (e) {
		error(400, e instanceof Error ? e.message : 'Cannot start OAuth');
	}
	redirect(302, url);
};
