import type { Handle } from '@sveltejs/kit';
import { bootstrap } from '$lib/server/bootstrap';
import { config } from '$lib/server/config';
import {
	isAuthenticated,
	proxyIdentity,
	createSessionValue,
	sessionCookieOptions,
	SESSION_COOKIE
} from '$lib/server/auth';
import type { RequestEvent } from '@sveltejs/kit';

// Runs once per process, before the first request is handled.
bootstrap();

// Routes reachable without auth (the login flow + the health probe).
const PUBLIC_PATHS = new Set(['/login', '/logout', '/api/health']);

/**
 * When the SSO proxy vouches for a request but the browser has no MyTube session
 * yet, mint one. The outpost strips its identity header from skip-path requests
 * (media, API), so the browser's `<video src="/api/stream/…">` and XHRs would
 * otherwise arrive unauthenticated — the session cookie set here carries them.
 * No-op unless forward-auth is configured and this is a genuine proxy request.
 */
function mintProxySessionIfNeeded(event: RequestEvent): void {
	if (!config.authProxyEnabled) return;
	if (event.cookies.get(SESSION_COOKIE)) return; // already has a session
	if (!proxyIdentity(event)) return; // not a trusted proxy request
	event.cookies.set(SESSION_COOKIE, createSessionValue(), sessionCookieOptions());
}

export const handle: Handle = async ({ event, resolve }) => {
	const authEnabled = config.authEnabled;
	event.locals.authEnabled = authEnabled;

	if (!authEnabled) {
		// LAN-only mode: open. (Static assets are served before hooks anyway.)
		event.locals.authed = true;
		return resolve(event);
	}

	const { pathname } = event.url;
	// Public share links (`/s/<token>` + their scoped media) do their own
	// per-token check inside the route and grant access to one video only.
	if (PUBLIC_PATHS.has(pathname) || pathname.startsWith('/s/')) {
		event.locals.authed = isAuthenticated(event);
		return resolve(event);
	}

	if (isAuthenticated(event)) {
		event.locals.authed = true;
		mintProxySessionIfNeeded(event);
		return resolve(event);
	}

	// Unauthenticated: JSON 401 for API, redirect to login for pages.
	event.locals.authed = false;
	if (pathname.startsWith('/api/')) {
		return new Response(JSON.stringify({ error: 'unauthorized' }), {
			status: 401,
			headers: { 'content-type': 'application/json', 'www-authenticate': 'Bearer' }
		});
	}
	const redirectTo = encodeURIComponent(pathname + event.url.search);
	return new Response(null, { status: 303, headers: { location: `/login?redirect=${redirectTo}` } });
};
