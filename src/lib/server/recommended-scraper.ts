import fs from 'node:fs';
import { config } from './config';
import { getSettings, setSetting } from './settings';
import { extractRecommended, type RecommendedItem } from './recommended';
import { ingestRecommended } from './discover';

/**
 * Playwright driver for the recommended feed. Isolated from parsing (see
 * recommended.ts). Politeness rules baked in:
 *   - one session at a time (module lock), reused persistent context
 *   - block image/media/font requests
 *   - on consent wall / captcha / logged-out: pause + surface a Settings banner
 *     instead of retry-hammering
 *
 * playwright is imported dynamically so the app runs fine without it installed.
 */

let running = false;

export function isRecommendedRunning(): boolean {
	return running;
}

export async function runRecommendedScrape(): Promise<{ status: string; added?: number; message: string }> {
	if (!config.recommendedFeedEnabled) {
		return { status: 'disabled', message: 'Recommended feed is disabled (RECOMMENDED_FEED_ENABLED=false).' };
	}
	if (!fs.existsSync(config.cookiesPath)) {
		setStatus('needs_attention', 'Upload your YouTube cookies.txt to enable the recommended feed.');
		return { status: 'needs_attention', message: 'No cookies uploaded.' };
	}
	if (running) return { status: 'busy', message: 'A scrape is already in progress.' };
	running = true;

	let chromium;
	try {
		({ chromium } = await import('playwright'));
	} catch {
		running = false;
		setStatus('needs_attention', 'Chromium/Playwright is not installed in this image (build the runtime-chromium target).');
		return { status: 'needs_attention', message: 'Playwright not installed.' };
	}

	fs.mkdirSync(config.browserProfileDir, { recursive: true });
	const context = await chromium.launchPersistentContext(config.browserProfileDir, {
		headless: true,
		viewport: { width: 1280, height: 900 },
		userAgent:
			'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
	});

	try {
		// Seed cookies from the uploaded file (keeps the session fresh across rotation).
		await seedCookies(context);

		const page = await context.newPage();
		// Be light: drop heavy resources.
		await page.route('**/*', (route) => {
			const type = route.request().resourceType();
			if (type === 'image' || type === 'media' || type === 'font') route.abort();
			else route.continue();
		});

		// Capture browse continuation JSON as we scroll.
		const captured: unknown[] = [];
		page.on('response', async (res) => {
			if (res.url().includes('/youtubei/v1/browse')) {
				try {
					captured.push(await res.json());
				} catch {
					/* not json / aborted */
				}
			}
		});

		await page.goto('https://www.youtube.com/', { waitUntil: 'domcontentloaded', timeout: 45_000 });

		const wall = await detectWall(page);
		if (wall) {
			setStatus('needs_attention', wall);
			return { status: 'needs_attention', message: wall };
		}

		const initial = await page.evaluate(() => {
			// @ts-expect-error - injected by YouTube
			return window.ytInitialData ?? null;
		});

		// Scroll a few times to pull continuations (polite: small, bounded).
		for (let i = 0; i < 3; i++) {
			await page.evaluate(() => window.scrollBy(0, window.innerHeight * 2));
			await page.waitForTimeout(1500);
		}

		const s = getSettings();
		const opts = {
			filterShorts: s.recommendedFilterShorts,
			filterLive: s.recommendedFilterLive,
			filterMixes: s.recommendedFilterMixes
		};
		const items: RecommendedItem[] = [
			...extractRecommended(initial, opts),
			...captured.flatMap((c) => extractRecommended(c, opts))
		];
		const deduped = dedupe(items);

		const added = ingestRecommended(deduped);
		setStatus('ok', `Last scrape: ${deduped.length} items seen, ${added} new.`);
		return { status: 'ok', added, message: `${added} new recommended item(s).` };
	} catch (err) {
		const message = err instanceof Error ? err.message : 'scrape failed';
		setStatus('needs_attention', `Scrape error: ${message}`);
		return { status: 'error', message };
	} finally {
		await context.close().catch(() => {});
		running = false;
	}
}

function dedupe(items: RecommendedItem[]): RecommendedItem[] {
	const seen = new Set<string>();
	const out: RecommendedItem[] = [];
	for (const i of items) {
		if (seen.has(i.videoId)) continue;
		seen.add(i.videoId);
		out.push(i);
	}
	return out;
}

/** Heuristic detection of consent walls, captchas, and logged-out states. */
async function detectWall(page: import('playwright').Page): Promise<string | null> {
	const url = page.url();
	if (url.includes('consent.youtube.com') || url.includes('/consent')) {
		return 'YouTube is showing a consent wall — re-upload fresh cookies.';
	}
	const loggedIn = await page
		.evaluate(() => {
			// @ts-expect-error injected
			const data = window.ytInitialData;
			const cfg = (window as unknown as { ytcfg?: { data_?: Record<string, unknown> } }).ytcfg;
			const signedIn = cfg?.data_?.LOGGED_IN;
			return { hasData: !!data, signedIn: signedIn === true };
		})
		.catch(() => ({ hasData: false, signedIn: false }));
	if (!loggedIn.hasData) return 'Could not read the YouTube home page (captcha or block?).';
	if (!loggedIn.signedIn) return 'Session is logged out — re-upload your cookies.txt.';
	return null;
}

/** Parse Netscape cookies.txt and inject into the browser context. */
async function seedCookies(context: import('playwright').BrowserContext): Promise<void> {
	const text = fs.readFileSync(config.cookiesPath, 'utf-8');
	const cookies = parseNetscapeCookies(text);
	if (cookies.length) await context.addCookies(cookies).catch(() => {});
}

interface PwCookie {
	name: string;
	value: string;
	domain: string;
	path: string;
	expires: number;
	httpOnly: boolean;
	secure: boolean;
}

export function parseNetscapeCookies(text: string): PwCookie[] {
	const out: PwCookie[] = [];
	for (const line of text.split('\n')) {
		const raw = line.trim();
		if (!raw || raw.startsWith('#')) continue;
		const parts = raw.split('\t');
		if (parts.length < 7) continue;
		const [domain, , path, secure, expires, name, value] = parts;
		if (!name) continue;
		out.push({
			name,
			value: value ?? '',
			domain,
			path: path || '/',
			expires: Number.parseInt(expires, 10) || -1,
			httpOnly: false,
			secure: secure.toUpperCase() === 'TRUE'
		});
	}
	return out;
}

function setStatus(status: 'ok' | 'needs_attention' | 'never_run', message: string): void {
	setSetting('recommendedStatus', status);
	setSetting('recommendedMessage', message);
}
