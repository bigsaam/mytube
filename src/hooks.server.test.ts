import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';

/**
 * Path-level auth guarantees, exercising the real `handle` hook.
 *
 * The one the share feature depends on: a `/s/<token>` request with NO session,
 * NO bearer, and NO proxy header must pass straight through — a friend with no
 * account (and, once the outpost is live, no SSO session) can still watch a
 * shared video. If this ever regresses, sharing is broken.
 */

const cfg = {
	databasePath: `${process.env.TMPDIR || '/tmp'}/mytube-hooks-${Date.now()}-${Math.random().toString(16).slice(2)}/t.db`,
	dataRoot: `${process.env.TMPDIR || '/tmp'}/mytube-hooks-data`,
	authSecret: 'cookie-signing-secret',
	authMasterToken: 'mt_master_token',
	authPassword: null as string | null,
	cookieSecure: false,
	authProxySecret: 'outpost-secret' as string | null,
	authProxySecretHeader: 'x-mytube-proxy-secret',
	authProxyIdentityHeader: 'x-authentik-email',
	get authEnabled() {
		return !!(this.authMasterToken || this.authPassword);
	},
	get authProxyEnabled() {
		return !!this.authProxySecret;
	}
};
vi.mock('$lib/server/config', () => ({ config: cfg }));
vi.mock('./config', () => ({ config: cfg }));
// bootstrap() runs at import time (DB, scheduler) — neutralise it for the test.
vi.mock('$lib/server/bootstrap', () => ({ bootstrap: () => {} }));

type Hooks = typeof import('./hooks.server');
let handle: Hooks['handle'];

beforeAll(async () => {
	const { runMigrations } = await import('$lib/server/db/migrate');
	runMigrations();
	({ handle } = await import('./hooks.server'));
});

const PASSED = new Response('ok', { status: 200 });
const setCookies: Record<string, string> = {};

beforeEach(() => {
	for (const k of Object.keys(setCookies)) delete setCookies[k];
});

function event(path: string, headers: Record<string, string> = {}, sessionCookie?: string): RequestEvent {
	const url = new URL(`http://localhost${path}`);
	return {
		url,
		request: new Request(url, { headers: new Headers(headers) }),
		cookies: {
			get: (name: string) => (name === 'mt_session' ? sessionCookie : undefined),
			set: (name: string, value: string) => {
				setCookies[name] = value;
			}
		},
		locals: {}
	} as unknown as RequestEvent;
}

const run = (ev: RequestEvent) => handle({ event: ev, resolve: async () => PASSED } as never);

describe('handle — share links stay public', () => {
	it('lets an anonymous /s/<token> request through (no creds at all)', async () => {
		const res = await run(event('/s/abc123'));
		expect(res).toBe(PASSED); // reached the route, which self-verifies the token
	});

	it('lets an anonymous /s/<token>/stream (video bytes) through', async () => {
		const res = await run(event('/s/abc123/stream'));
		expect(res).toBe(PASSED);
	});

	it('keeps the health probe public', async () => {
		expect(await run(event('/api/health'))).toBe(PASSED);
	});
});

describe('handle — human pages require auth', () => {
	it('redirects an anonymous page request to /login', async () => {
		const res = await run(event('/library'));
		expect(res.status).toBe(303);
		expect(res.headers.get('location')).toContain('/login');
	});

	it('401s an anonymous API request', async () => {
		const res = await run(event('/api/downloads'));
		expect(res.status).toBe(401);
	});
});

describe('handle — SSO proxy forward-auth', () => {
	it('admits a trusted proxy request and mints a session cookie', async () => {
		const res = await run(
			event('/library', { 'x-mytube-proxy-secret': 'outpost-secret', 'x-authentik-email': 'sam@example.com' })
		);
		expect(res).toBe(PASSED);
		expect(setCookies.mt_session).toBeTruthy(); // so /api/stream works next
	});

	it('does NOT admit a forged identity header without the secret (anti-spoof)', async () => {
		const res = await run(event('/library', { 'x-authentik-email': 'attacker@evil.com' }));
		expect(res.status).toBe(303);
		expect(setCookies.mt_session).toBeUndefined();
	});
});
