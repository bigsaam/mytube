import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';

/**
 * Forward-auth via an SSO proxy (Authentik outpost).
 *
 * The security-critical property: MyTube trusts the identity header ONLY when
 * the secret header — which only the outpost injects — matches. Anyone able to
 * reach the container directly could otherwise forge `x-authentik-email` and
 * walk in. These tests pin that gate, and the "dormant unless configured"
 * guarantee that keeps prod behaviour unchanged until the outpost is wired.
 */

const SECRET = 'outpost-shared-secret-abc123';
const cfg = {
	databasePath: `${process.env.TMPDIR || '/tmp'}/mytube-authproxy-${Date.now()}-${Math.random().toString(16).slice(2)}/t.db`,
	dataRoot: `${process.env.TMPDIR || '/tmp'}/mytube-authproxy-data`,
	authSecret: 'cookie-signing-secret',
	authMasterToken: 'mt_master_token',
	authPassword: null as string | null,
	cookieSecure: false,
	// forward-auth — toggled per test via the mutable object below
	authProxySecret: SECRET as string | null,
	authProxySecretHeader: 'x-mytube-proxy-secret',
	authProxyIdentityHeader: 'x-authentik-email',
	get authProxyEnabled() {
		return !!this.authProxySecret;
	}
};
vi.mock('$lib/server/config', () => ({ config: cfg }));
vi.mock('./config', () => ({ config: cfg }));

type Auth = typeof import('./auth');
let A: Auth;

beforeAll(async () => {
	const { runMigrations } = await import('./db/migrate');
	runMigrations();
	A = await import('./auth');
});

beforeEach(() => {
	cfg.authProxySecret = SECRET;
});

/** Minimal RequestEvent: just headers, cookies, and query — all auth reads. */
function fakeEvent(headers: Record<string, string> = {}, cookie?: string): RequestEvent {
	const h = new Headers(headers);
	return {
		request: new Request('http://localhost/library', { headers: h }),
		cookies: { get: (name: string) => (name === 'mt_session' ? cookie : undefined) },
		url: new URL('http://localhost/library')
	} as unknown as RequestEvent;
}

describe('proxyIdentity — the anti-spoof gate', () => {
	it('accepts the identity header when the secret header matches', () => {
		const e = fakeEvent({ 'x-mytube-proxy-secret': SECRET, 'x-authentik-email': 'sam@example.com' });
		expect(A.proxyIdentity(e)).toBe('sam@example.com');
	});

	it('REJECTS a forged identity header when the secret header is absent', () => {
		// The spoofing attempt: a client that reached MyTube directly and set only
		// the identity header. Must not authenticate.
		const e = fakeEvent({ 'x-authentik-email': 'attacker@evil.com' });
		expect(A.proxyIdentity(e)).toBeNull();
	});

	it('REJECTS when the secret header is present but wrong', () => {
		const e = fakeEvent({ 'x-mytube-proxy-secret': 'wrong', 'x-authentik-email': 'sam@example.com' });
		expect(A.proxyIdentity(e)).toBeNull();
	});

	it('returns null when the identity header is missing even with a valid secret', () => {
		const e = fakeEvent({ 'x-mytube-proxy-secret': SECRET });
		expect(A.proxyIdentity(e)).toBeNull();
	});

	it('is dormant when no proxy secret is configured (prod unchanged)', () => {
		cfg.authProxySecret = null;
		const e = fakeEvent({ 'x-mytube-proxy-secret': SECRET, 'x-authentik-email': 'sam@example.com' });
		expect(A.proxyIdentity(e)).toBeNull();
	});
});

describe('isAuthenticated — proxy identity composes with existing credentials', () => {
	it('authenticates a trusted proxy request (no cookie, no bearer)', () => {
		const e = fakeEvent({ 'x-mytube-proxy-secret': SECRET, 'x-authentik-email': 'sam@example.com' });
		expect(A.isAuthenticated(e)).toBe(true);
	});

	it('still authenticates a bearer token (machines) with no proxy headers', () => {
		const e = fakeEvent({ authorization: 'Bearer mt_master_token' });
		expect(A.isAuthenticated(e)).toBe(true);
	});

	it('denies a request with a forged identity header and nothing else', () => {
		const e = fakeEvent({ 'x-authentik-email': 'attacker@evil.com' });
		expect(A.isAuthenticated(e)).toBe(false);
	});
});
