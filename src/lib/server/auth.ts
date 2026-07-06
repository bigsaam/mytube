import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { eq, and } from 'drizzle-orm';
import type { RequestEvent } from '@sveltejs/kit';
import { db } from './db';
import { apiTokens, type ApiToken } from './db/schema';
import { config } from './config';

/**
 * Authentication for MyTube. Two credential types, one check:
 *   - Session cookie (browser): HMAC-signed, httpOnly — set after /login.
 *   - Bearer token (programmatic): the env master token OR a revocable device
 *     token (hashed in the DB). Sent as `Authorization: Bearer`, `X-API-Token`,
 *     or `?token=` (last resort for media URLs).
 *
 * Auth is enforced only when it's configured (master token or login password).
 * All secret comparisons are constant-time.
 */

export const SESSION_COOKIE = 'mt_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const TOKEN_PREFIX = 'mt_';

/* --------------------------------------------------------- signing secret */

let cachedSecret: string | null = null;
function secret(): string {
	if (cachedSecret) return cachedSecret;
	if (config.authSecret) return (cachedSecret = config.authSecret);
	const file = path.join(config.dataRoot, 'auth-secret');
	try {
		cachedSecret = fs.readFileSync(file, 'utf-8').trim();
		if (cachedSecret) return cachedSecret;
	} catch {
		/* generate below */
	}
	cachedSecret = crypto.randomBytes(32).toString('hex');
	fs.mkdirSync(config.dataRoot, { recursive: true });
	fs.writeFileSync(file, cachedSecret, { mode: 0o600 });
	return cachedSecret;
}

/* --------------------------------------------------- constant-time helpers */

function safeEqual(a: string, b: string): boolean {
	const ab = Buffer.from(a);
	const bb = Buffer.from(b);
	if (ab.length !== bb.length) return false;
	return crypto.timingSafeEqual(ab, bb);
}

function sha256(input: string): string {
	return crypto.createHash('sha256').update(input).digest('hex');
}

/* -------------------------------------------------------- session cookies */

export function createSessionValue(): string {
	const exp = Date.now() + SESSION_TTL_MS;
	const sig = crypto.createHmac('sha256', secret()).update(String(exp)).digest('hex');
	return `${exp}.${sig}`;
}

function verifySessionValue(value: string | undefined): boolean {
	if (!value) return false;
	const dot = value.indexOf('.');
	if (dot < 0) return false;
	const exp = Number.parseInt(value.slice(0, dot), 10);
	const sig = value.slice(dot + 1);
	if (!Number.isFinite(exp) || exp < Date.now()) return false;
	const expected = crypto.createHmac('sha256', secret()).update(String(exp)).digest('hex');
	return safeEqual(sig, expected);
}

/** Cookie options for the session cookie (and its deletion). */
export function sessionCookieOptions() {
	return {
		path: '/',
		httpOnly: true,
		sameSite: 'lax' as const,
		secure: config.cookieSecure,
		maxAge: Math.floor(SESSION_TTL_MS / 1000)
	};
}

/* ---------------------------------------------------- login verification */

/** Verify the secret entered on the login page (master token, password, or a
 * device token). Used to mint a browser session. */
export function verifyLoginSecret(input: string): boolean {
	const val = input.trim();
	if (!val) return false;
	if (config.authMasterToken && safeEqual(val, config.authMasterToken)) return true;
	if (config.authPassword && safeEqual(val, config.authPassword)) return true;
	return verifyApiToken(val) != null;
}

/* ----------------------------------------------------- device api tokens */

export interface CreatedToken {
	token: string; // plaintext — shown once
	row: ApiToken;
}

export function createApiToken(name: string): CreatedToken {
	const token = TOKEN_PREFIX + crypto.randomBytes(24).toString('hex');
	const tokenHash = sha256(token);
	const tokenPrefix = token.slice(0, 11);
	db.insert(apiTokens).values({ name: name.slice(0, 60) || 'device', tokenHash, tokenPrefix }).run();
	const row = db.select().from(apiTokens).where(eq(apiTokens.tokenHash, tokenHash)).get()!;
	return { token, row };
}

export function listApiTokens(): Omit<ApiToken, 'tokenHash'>[] {
	return db
		.select({
			id: apiTokens.id,
			name: apiTokens.name,
			tokenPrefix: apiTokens.tokenPrefix,
			revoked: apiTokens.revoked,
			createdAt: apiTokens.createdAt,
			lastUsedAt: apiTokens.lastUsedAt
		})
		.from(apiTokens)
		.orderBy(apiTokens.createdAt)
		.all();
}

export function revokeApiToken(id: number): void {
	db.update(apiTokens).set({ revoked: true }).where(eq(apiTokens.id, id)).run();
}

/** Validate a bearer token. Returns 'master' or the token name, or null. */
export function verifyApiToken(token: string): string | null {
	if (config.authMasterToken && safeEqual(token, config.authMasterToken)) return 'master';
	if (!token.startsWith(TOKEN_PREFIX)) return null;
	const hash = sha256(token);
	const row = db
		.select()
		.from(apiTokens)
		.where(and(eq(apiTokens.tokenHash, hash), eq(apiTokens.revoked, false)))
		.get();
	if (!row) return null;
	// Throttled last-used bookkeeping.
	if (!row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() > 60_000) {
		db.update(apiTokens).set({ lastUsedAt: new Date() }).where(eq(apiTokens.id, row.id)).run();
	}
	return row.name;
}

/* --------------------------------------------------------- request check */

function extractBearer(event: RequestEvent): string | null {
	const auth = event.request.headers.get('authorization');
	if (auth?.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim();
	const xat = event.request.headers.get('x-api-token');
	if (xat) return xat.trim();
	const q = event.url.searchParams.get('token');
	if (q) return q.trim();
	return null;
}

/** True if the request carries a valid session cookie or bearer token. */
export function isAuthenticated(event: RequestEvent): boolean {
	if (verifySessionValue(event.cookies.get(SESSION_COOKIE))) return true;
	const token = extractBearer(event);
	return token != null && verifyApiToken(token) != null;
}
