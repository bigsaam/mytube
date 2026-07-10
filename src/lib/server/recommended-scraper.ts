import fs from 'node:fs';
import { config } from './config';
import { getSettings, setSetting } from './settings';
import {
	extractRecommended,
	countRendererKeys,
	summarizeRenderers,
	type RecommendedItem
} from './recommended';
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

		// Capture browse continuation JSON as we scroll. `res.json()` is async, so
		// track the in-flight parses and drain them before we read `captured`.
		const captured: unknown[] = [];
		const parsing: Promise<void>[] = [];
		page.on('response', (res) => {
			if (!res.url().includes('/youtubei/v1/browse')) return;
			parsing.push(
				res.json().then(
					(json) => void captured.push(json),
					() => {
						/* not json / aborted */
					}
				)
			);
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

		await harvestContinuations(page);
		await Promise.all(parsing);

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

		console.log(
			`[recommended] scrape: ${deduped.length} item(s) seen (initialData=${initial ? 'yes' : 'no'}, continuations=${captured.length})`
		);

		// A logged-in YouTube home is never empty. Zero items means we loaded and
		// parsed the page but recognised nothing in it — nearly always YouTube
		// shape drift. Reporting that as `ok` makes a silent parser break look
		// like a healthy scrape, so surface it and log WHICH renderers we saw.
		if (deduped.length === 0) {
			const seen = summarizeRenderers(rendererHistogram([initial, ...captured]));
			console.warn(`[recommended] 0 items — possible shape drift. renderers seen: ${seen}`);
			const message = `Scrape ran but found no videos — YouTube's page shape likely changed. Renderers seen: ${seen}`;
			setStatus('needs_attention', message);
			return { status: 'needs_attention', added: 0, message };
		}

		const added = ingestRecommended(deduped);
		console.log(`[recommended] ingested ${added} new item(s) of ${deduped.length} seen`);
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

/** How many bottom-scrolls to attempt per scrape. Polite: bounded, and we stop
 * early the moment YouTube stops answering with a continuation. */
const SCROLL_ROUNDS = 5;
/** A continuation normally lands well inside this; a miss means "no more feed". */
const CONTINUATION_TIMEOUT_MS = 8_000;

/**
 * Scroll to the bottom repeatedly so YouTube's continuation sentinel enters the
 * viewport and fires `/youtubei/v1/browse`. Each round waits for that response
 * rather than a blind sleep — the old fixed `scrollBy` + sleep raced the feed's
 * first render and harvested zero continuations.
 */
async function harvestContinuations(page: import('playwright').Page): Promise<void> {
	// Scrolling is meaningless until the feed has rendered enough to overflow the
	// viewport. Gate on that rather than on a YouTube tag name, which drifts.
	const scrollable = await page
		.waitForFunction(
			() => {
				const el = document.scrollingElement ?? document.documentElement;
				return el.scrollHeight > window.innerHeight * 1.5;
			},
			{ timeout: 20_000 }
		)
		.then(
			() => true,
			() => false
		);
	if (!scrollable) {
		console.warn('[recommended] home feed never became scrollable — harvesting initial page only.');
		return;
	}

	for (let i = 0; i < SCROLL_ROUNDS; i++) {
		const continuation = page
			.waitForResponse((res) => res.url().includes('/youtubei/v1/browse'), {
				timeout: CONTINUATION_TIMEOUT_MS
			})
			.catch(() => null);

		await page.evaluate(() => {
			const el = document.scrollingElement ?? document.documentElement;
			el.scrollTop = el.scrollHeight;
		});

		if (!(await continuation)) break; // feed exhausted, or YouTube stopped serving.
		// Let the new rows lay out so the next scroll reaches a genuinely new bottom.
		await page.waitForTimeout(750);
	}
}

/** Tally feed-item renderer keys across the initial payload + continuations. */
function rendererHistogram(sources: unknown[]): Record<string, number> {
	const total: Record<string, number> = {};
	for (const src of sources) {
		for (const [k, n] of Object.entries(countRendererKeys(src))) {
			total[k] = (total[k] ?? 0) + n;
		}
	}
	return total;
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
