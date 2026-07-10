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

export interface ScrapeResult {
	status: string;
	added?: number;
	message: string;
}

/** Preconditions shared by every scrape. Returns a message when we must not run. */
function preflight(): string | null {
	if (!config.recommendedFeedEnabled) {
		return 'Recommended feed is disabled (RECOMMENDED_FEED_ENABLED=false).';
	}
	if (!fs.existsSync(config.cookiesPath)) {
		return 'No cookies uploaded.';
	}
	return null;
}

/**
 * Open a cookie-seeded, resource-light YouTube page and hand it to `fn`. Holds
 * the module lock so only one scrape session runs at a time, and always tears
 * the browser down. Callers own their own status reporting.
 */
async function withYouTubePage<T>(fn: (page: import('playwright').Page) => Promise<T>): Promise<T> {
	let chromium;
	try {
		({ chromium } = await import('playwright'));
	} catch {
		throw new Error('Chromium/Playwright is not installed in this image (build the runtime-chromium target).');
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
		return await fn(page);
	} finally {
		await context.close().catch(() => {});
	}
}

/**
 * Scrape the related ("up next") rail of a watch page and ingest it as `upnext`,
 * tagged with the video that produced it. The watch page uses the same
 * `lockupViewModel` shape as the home feed, so no extra parsing is needed — see
 * recommended.upnext.test.ts.
 *
 * Deliberately quieter than the home scrape: a single scroll round. The initial
 * payload carries ~20 related videos; one round measured ~59 in practice — plenty
 * to seed the pool. Every extra request is more drift surface and more cookie
 * burn, and this fires on every video watched.
 */
export async function runUpnextScrape(videoId: string): Promise<ScrapeResult> {
	const blocked = preflight();
	if (blocked) return { status: 'skipped', message: blocked };
	if (running) return { status: 'busy', message: 'A scrape is already in progress.' };
	running = true;

	try {
		return await withYouTubePage(async (page) => {
			// Parse the `/next` continuation payloads directly, exactly as the home
			// scrape parses `/browse`. Do NOT wait for YouTube to merge them back into
			// `window.ytInitialData` — on a watch page that merge is unreliable and,
			// when it happens at all, lands seconds after the response resolves.
			const next = captureResponses(page, '/youtubei/v1/next');

			await page.goto(`https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`, {
				waitUntil: 'domcontentloaded',
				timeout: 45_000
			});

			const wall = await detectWall(page);
			if (wall) {
				setStatus('needs_attention', wall);
				return { status: 'needs_attention', message: wall };
			}

			const initial = await readInitialData(page);
			await harvestContinuations(page, '/youtubei/v1/next', UPNEXT_SCROLL_ROUNDS);
			const continuations = await next.drain();

			const s = getSettings();
			const opts = {
				filterShorts: s.recommendedFilterShorts,
				filterLive: s.recommendedFilterLive,
				filterMixes: s.recommendedFilterMixes
			};
			const items = dedupe([
				...extractRecommended(initial, opts),
				...continuations.flatMap((c) => extractRecommended(c, opts))
			]).filter((i) => i.videoId !== videoId); // never re-ingest the source video

			if (items.length === 0) {
				const seen = summarizeRenderers(rendererHistogram([initial, ...continuations]));
				console.warn(`[recommended] up-next ${videoId}: 0 items — possible drift. renderers seen: ${seen}`);
				return { status: 'needs_attention', added: 0, message: `No related videos found. Renderers seen: ${seen}` };
			}

			const added = ingestRecommended(items, { source: 'upnext', sourceVideoId: videoId });
			console.log(
				`[recommended] up-next ${videoId}: ${items.length} related seen (continuations=${continuations.length}), ${added} new`
			);
			return { status: 'ok', added, message: `${added} new up-next item(s).` };
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : 'up-next scrape failed';
		console.warn(`[recommended] up-next ${videoId} failed: ${message}`);
		return { status: 'error', message };
	} finally {
		running = false;
	}
}

export async function runRecommendedScrape(): Promise<ScrapeResult> {
	if (!config.recommendedFeedEnabled) {
		return { status: 'disabled', message: 'Recommended feed is disabled (RECOMMENDED_FEED_ENABLED=false).' };
	}
	if (!fs.existsSync(config.cookiesPath)) {
		setStatus('needs_attention', 'Upload your YouTube cookies.txt to enable the recommended feed.');
		return { status: 'needs_attention', message: 'No cookies uploaded.' };
	}
	if (running) return { status: 'busy', message: 'A scrape is already in progress.' };
	running = true;

	try {
		return await withYouTubePage(async (page) => {
			// Capture browse continuation JSON as we scroll.
			const browse = captureResponses(page, '/youtubei/v1/browse');

			await page.goto('https://www.youtube.com/', { waitUntil: 'domcontentloaded', timeout: 45_000 });

			const wall = await detectWall(page);
			if (wall) {
				setStatus('needs_attention', wall);
				return { status: 'needs_attention', message: wall };
			}

			const initial = await readInitialData(page);

			await harvestContinuations(page, '/youtubei/v1/browse', HOME_SCROLL_ROUNDS);
			const captured = await browse.drain();

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
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : 'scrape failed';
		setStatus('needs_attention', `Scrape error: ${message}`);
		return { status: 'error', message };
	} finally {
		running = false;
	}
}

/** Bottom-scrolls per home scrape. Polite: bounded, stops early when dry. */
const HOME_SCROLL_ROUNDS = 5;
/**
 * Bottom-scrolls per watch page. The related rail paginates in blocks of ~20, so
 * one round yields ~40 items — plenty to seed the pool. Deliberately quieter
 * than the home scrape: up-next fires on every video watched.
 */
const UPNEXT_SCROLL_ROUNDS = 1;
/** A continuation normally lands well inside this; a miss means "nothing more". */
const CONTINUATION_TIMEOUT_MS = 8_000;

/**
 * Scroll to the bottom repeatedly so YouTube's continuation sentinel enters the
 * viewport and fires `endpoint`. Each round waits for that response rather than
 * sleeping blindly — a fixed `scrollBy` + sleep races the page's first render and
 * harvests nothing.
 *
 * Both surfaces need this. The home feed answers on `/youtubei/v1/browse` and we
 * capture those responses directly. The watch page answers on `/youtubei/v1/next`
 * and merges the result back into `window.ytInitialData`, so the caller just
 * re-reads that afterwards.
 */
async function harvestContinuations(
	page: import('playwright').Page,
	endpoint: string,
	rounds: number
): Promise<void> {
	// Scrolling is meaningless until the page has rendered enough to overflow the
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
		console.warn(`[recommended] page never became scrollable — harvesting initial payload only.`);
		return;
	}

	// `jiggle` re-enters the sentinel. Once parked at the bottom, setting
	// scrollTop = scrollHeight again moves nothing and fires no intersection, so a
	// naive retry is a silent no-op. Leaving and returning re-arms it.
	const scrollToBottom = (jiggle: boolean) =>
		page.evaluate(async (jig) => {
			const el = document.scrollingElement ?? document.documentElement;
			if (jig) {
				el.scrollTop = Math.max(0, el.scrollHeight - window.innerHeight * 3);
				await new Promise((r) => setTimeout(r, 300));
			}
			el.scrollTop = el.scrollHeight;
		}, jiggle);

	// Both `/browse` and `/next` are ALSO used for the page's own initial load. Those
	// requests carry no continuation token; the lazy-loaded ones do. Without this,
	// the very first scroll "matches" the page-load request, reports success, and
	// the harvest exits having paginated nothing.
	const isContinuation = (res: import('playwright').Response) =>
		res.url().includes(endpoint) && (res.request().postData()?.includes('"continuation"') ?? false);

	for (let i = 0; i < rounds; i++) {
		let got = false;
		for (let attempt = 0; attempt < 3 && !got; attempt++) {
			// Re-check every attempt: a watch page transiently COLLAPSES back to
			// exactly viewport height around `load`, and a scroll issued in that
			// window travels ~50px and triggers nothing. Waiting once is not enough.
			await page
				.waitForFunction(
					() => {
						const el = document.scrollingElement ?? document.documentElement;
						return el.scrollHeight > window.innerHeight * 1.5;
					},
					{ timeout: 20_000 }
				)
				.catch(() => {});

			const continuation = page
				.waitForResponse(isContinuation, { timeout: CONTINUATION_TIMEOUT_MS })
				.catch(() => null);
			await scrollToBottom(attempt > 0);
			got = (await continuation) !== null;
		}
		if (!got) break; // exhausted, or YouTube stopped serving.
		// Let the new rows lay out so the next scroll reaches a genuinely new bottom.
		await page.waitForTimeout(750);
	}
}

/** Read `window.ytInitialData`, which YouTube mutates as continuations merge in. */
async function readInitialData(page: import('playwright').Page): Promise<unknown> {
	return page.evaluate(() => {
		// @ts-expect-error - injected by YouTube
		return window.ytInitialData ?? null;
	});
}

/**
 * Collect `/youtubei/v1/<endpoint>` response bodies as they arrive. `res.json()`
 * is async, so the returned `drain()` must be awaited before reading `captured`
 * — otherwise a parse can still be in flight when the context closes.
 */
function captureResponses(
	page: import('playwright').Page,
	endpoint: string
): { captured: unknown[]; drain: () => Promise<unknown[]> } {
	const captured: unknown[] = [];
	const parsing: Promise<void>[] = [];
	page.on('response', (res) => {
		if (!res.url().includes(endpoint)) return;
		parsing.push(
			res.json().then(
				(json) => void captured.push(json),
				() => {
					/* not json / aborted */
				}
			)
		);
	});
	return { captured, drain: async () => (await Promise.all(parsing), captured) };
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
