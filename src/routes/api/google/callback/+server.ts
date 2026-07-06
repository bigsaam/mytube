import { redirect } from '@sveltejs/kit';
import { exchangeCode } from '$lib/server/google-auth';
import type { RequestHandler } from './$types';

/** OAuth redirect target. Verifies state, exchanges the code, stores tokens. */
export const GET: RequestHandler = async ({ url, cookies }) => {
	const err = url.searchParams.get('error');
	if (err) redirect(303, `/settings/youtube?error=${encodeURIComponent(err)}`);

	const code = url.searchParams.get('code');
	const state = url.searchParams.get('state');
	const expected = cookies.get('g_oauth_state');
	cookies.delete('g_oauth_state', { path: '/' });

	if (!code || !state || state !== expected) {
		redirect(303, '/settings/youtube?error=state_mismatch');
	}

	try {
		await exchangeCode(code);
	} catch (e) {
		redirect(303, `/settings/youtube?error=${encodeURIComponent(e instanceof Error ? e.message : 'exchange_failed')}`);
	}
	redirect(303, '/settings/youtube?connected=1');
};
