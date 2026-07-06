import { redirect } from '@sveltejs/kit';
import { SESSION_COOKIE } from '$lib/server/auth';
import type { RequestHandler } from './$types';

const handler: RequestHandler = ({ cookies }) => {
	cookies.delete(SESSION_COOKIE, { path: '/' });
	return redirect(303, '/login');
};

export const GET = handler;
export const POST = handler;
