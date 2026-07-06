import fs from 'node:fs';
import path from 'node:path';
import { config } from './config';

/**
 * Google OAuth 2.0 for the YouTube Data API (playlist sync + removal).
 *
 * Client id/secret and the refresh token live in a 0600 file under /data —
 * never in the settings table and never sent to the browser. The only thing the
 * UI ever sees is a boolean "connected" status.
 *
 * Scope: youtube (read + write playlist items). Access type offline so we get a
 * refresh token and can act without the user present.
 */

const SCOPE = 'https://www.googleapis.com/auth/youtube';
const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

interface Creds {
	clientId?: string;
	clientSecret?: string;
	refreshToken?: string;
	accessToken?: string;
	accessTokenExpiry?: number; // unix ms
}

function credsPath(): string {
	return path.join(config.dataRoot, 'google-oauth.json');
}

function read(): Creds {
	try {
		return JSON.parse(fs.readFileSync(credsPath(), 'utf-8')) as Creds;
	} catch {
		return {};
	}
}

function write(creds: Creds): void {
	fs.mkdirSync(config.dataRoot, { recursive: true });
	fs.writeFileSync(credsPath(), JSON.stringify(creds, null, 2), { mode: 0o600 });
}

export function redirectUri(): string {
	return `${config.origin.replace(/\/$/, '')}/api/google/callback`;
}

export function setClientCredentials(clientId: string, clientSecret: string): void {
	const creds = read();
	write({ ...creds, clientId: clientId.trim(), clientSecret: clientSecret.trim() });
}

export function authStatus(): { hasClientCreds: boolean; connected: boolean } {
	const c = read();
	return { hasClientCreds: !!(c.clientId && c.clientSecret), connected: !!c.refreshToken };
}

/** Build the consent URL. `state` is echoed back to the callback (CSRF token). */
export function getAuthUrl(state: string): string {
	const c = read();
	if (!c.clientId) throw new Error('Set your Google OAuth client ID/secret first.');
	const params = new URLSearchParams({
		client_id: c.clientId,
		redirect_uri: redirectUri(),
		response_type: 'code',
		scope: SCOPE,
		access_type: 'offline',
		include_granted_scopes: 'true',
		// force a refresh token even on re-consent
		prompt: 'consent',
		state
	});
	return `${AUTH_ENDPOINT}?${params}`;
}

/** Exchange an auth code for tokens and persist the refresh token. */
export async function exchangeCode(code: string): Promise<void> {
	const c = read();
	if (!c.clientId || !c.clientSecret) throw new Error('Missing client credentials.');
	const res = await fetch(TOKEN_ENDPOINT, {
		method: 'POST',
		headers: { 'content-type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			code,
			client_id: c.clientId,
			client_secret: c.clientSecret,
			redirect_uri: redirectUri(),
			grant_type: 'authorization_code'
		}),
		signal: AbortSignal.timeout(20_000)
	});
	const data = (await res.json()) as {
		access_token?: string;
		refresh_token?: string;
		expires_in?: number;
		error?: string;
		error_description?: string;
	};
	if (!res.ok || !data.access_token) {
		throw new Error(data.error_description ?? data.error ?? 'Token exchange failed');
	}
	write({
		...c,
		refreshToken: data.refresh_token ?? c.refreshToken,
		accessToken: data.access_token,
		accessTokenExpiry: Date.now() + (data.expires_in ?? 3600) * 1000
	});
}

/** Return a valid access token, refreshing if needed. Throws if not connected. */
export async function getAccessToken(): Promise<string> {
	const c = read();
	if (!c.refreshToken) throw new Error('YouTube account not connected.');
	if (c.accessToken && c.accessTokenExpiry && c.accessTokenExpiry > Date.now() + 60_000) {
		return c.accessToken;
	}
	const res = await fetch(TOKEN_ENDPOINT, {
		method: 'POST',
		headers: { 'content-type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			client_id: c.clientId ?? '',
			client_secret: c.clientSecret ?? '',
			refresh_token: c.refreshToken,
			grant_type: 'refresh_token'
		}),
		signal: AbortSignal.timeout(20_000)
	});
	const data = (await res.json()) as {
		access_token?: string;
		expires_in?: number;
		error?: string;
		error_description?: string;
	};
	if (!res.ok || !data.access_token) {
		// A revoked/expired refresh token means the user must reconnect.
		if (data.error === 'invalid_grant') disconnect();
		throw new Error(data.error_description ?? data.error ?? 'Token refresh failed');
	}
	write({
		...c,
		accessToken: data.access_token,
		accessTokenExpiry: Date.now() + (data.expires_in ?? 3600) * 1000
	});
	return data.access_token;
}

export function disconnect(): void {
	const c = read();
	// Keep client id/secret so reconnecting doesn't require re-entering them.
	write({ clientId: c.clientId, clientSecret: c.clientSecret });
}
