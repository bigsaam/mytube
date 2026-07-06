import type { Handle } from '@sveltejs/kit';
import { bootstrap } from '$lib/server/bootstrap';
import { config } from '$lib/server/config';
import { isAuthenticated } from '$lib/server/auth';

// Runs once per process, before the first request is handled.
bootstrap();

// Routes reachable without auth (the login flow + the health probe).
const PUBLIC_PATHS = new Set(['/login', '/logout', '/api/health']);

export const handle: Handle = async ({ event, resolve }) => {
	const authEnabled = config.authEnabled;
	event.locals.authEnabled = authEnabled;

	if (!authEnabled) {
		// LAN-only mode: open. (Static assets are served before hooks anyway.)
		event.locals.authed = true;
		return resolve(event);
	}

	const { pathname } = event.url;
	if (PUBLIC_PATHS.has(pathname)) {
		event.locals.authed = isAuthenticated(event);
		return resolve(event);
	}

	if (isAuthenticated(event)) {
		event.locals.authed = true;
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
