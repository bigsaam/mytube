import { fail, redirect } from '@sveltejs/kit';
import { config } from '$lib/server/config';
import { verifyLoginSecret, createSessionValue, SESSION_COOKIE, sessionCookieOptions } from '$lib/server/auth';
import type { PageServerLoad, Actions } from './$types';

// Basic in-memory login throttle (per client IP).
const attempts = new Map<string, { count: number; resetAt: number }>();
const MAX_ATTEMPTS = 8;
const WINDOW_MS = 15 * 60_000;

function safeRedirect(target: string | null): string {
	// Only allow same-site absolute paths — never an open redirect.
	if (target && target.startsWith('/') && !target.startsWith('//')) return target;
	return '/';
}

export const load: PageServerLoad = ({ locals, url }) => {
	if (!config.authEnabled) redirect(303, '/');
	if (locals.authed) redirect(303, safeRedirect(url.searchParams.get('redirect')));
	return { usesPassword: !!config.authPassword };
};

export const actions: Actions = {
	default: async ({ request, cookies, getClientAddress, url }) => {
		const ip = getClientAddress();
		const now = Date.now();
		const rec = attempts.get(ip);
		if (rec && rec.resetAt > now && rec.count >= MAX_ATTEMPTS) {
			return fail(429, { error: 'Too many attempts. Wait a few minutes.' });
		}

		const form = await request.formData();
		const secret = String(form.get('secret') ?? '');

		if (!verifyLoginSecret(secret)) {
			// Count the failure and slow the response to blunt brute-forcing.
			const next = rec && rec.resetAt > now ? rec : { count: 0, resetAt: now + WINDOW_MS };
			next.count += 1;
			attempts.set(ip, next);
			await new Promise((r) => setTimeout(r, 600));
			return fail(401, { error: 'Incorrect password or token.' });
		}

		attempts.delete(ip);
		cookies.set(SESSION_COOKIE, createSessionValue(), sessionCookieOptions());
		redirect(303, safeRedirect(form.get('redirect') as string | null));
	}
};
