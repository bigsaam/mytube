import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config';
import type { Chapter } from './db/schema';

/**
 * The ONE place that knows how to talk to yt-dlp. All flags, format selection,
 * and output parsing live here so YouTube/extractor breakage is a single-file
 * fix. Nothing else in the app spawns yt-dlp directly.
 */

export interface ProbeResult {
	videoId: string;
	title: string;
	channelId: string | null;
	channelName: string | null;
	durationSeconds: number | null;
	thumbnail: string | null;
	uploadDate: Date | null;
	description: string | null;
	isLive: boolean;
	wasLive: boolean;
}

export interface PlaylistEntry {
	videoId: string;
	title: string;
	channelName: string | null;
	durationSeconds: number | null;
}

export interface DownloadProgress {
	percent: number; // 0..1 for the current file
	speed: string | null;
	eta: string | null;
	stage: string; // download | merge | subtitles | thumbnail | metadata
}

export interface DownloadResult {
	videoPath: string | null;
	thumbnailPath: string | null;
	subtitlePath: string | null;
	infoJsonPath: string | null;
	info: RawInfo | null;
}

export interface RawInfo {
	id: string;
	title: string;
	description?: string;
	duration?: number;
	channel?: string;
	uploader?: string;
	channel_id?: string;
	uploader_id?: string;
	upload_date?: string; // YYYYMMDD
	width?: number;
	height?: number;
	ext?: string;
	filesize?: number;
	filesize_approx?: number;
	chapters?: { title?: string; start_time: number; end_time?: number }[];
	is_live?: boolean;
	was_live?: boolean;
	thumbnail?: string;
}

/* ------------------------------------------------------------------ spawn */

interface RunOptions {
	onLine?: (line: string, stream: 'stdout' | 'stderr') => void;
	signal?: AbortSignal;
	timeoutMs?: number;
}

class YtDlpError extends Error {
	constructor(
		message: string,
		public readonly tail: string,
		public readonly code: number | null
	) {
		super(message);
		this.name = 'YtDlpError';
	}
}

/** Low-level runner. Streams lines to onLine; keeps a rolling tail for errors. */
function run(args: string[], opts: RunOptions = {}): Promise<{ stdout: string; tail: string }> {
	return new Promise((resolve, reject) => {
		const child = spawn(config.ytdlpPath, args, { signal: opts.signal });
		let stdout = '';
		const tailLines: string[] = [];
		const pushTail = (s: string) => {
			for (const line of s.split('\n')) {
				if (line.trim()) tailLines.push(line);
			}
			while (tailLines.length > 40) tailLines.shift();
		};

		let stdoutBuf = '';
		let stderrBuf = '';
		const pump = (chunk: string, stream: 'stdout' | 'stderr') => {
			const buf = (stream === 'stdout' ? stdoutBuf : stderrBuf) + chunk;
			const lines = buf.split('\n');
			const rest = lines.pop() ?? '';
			if (stream === 'stdout') stdoutBuf = rest;
			else stderrBuf = rest;
			for (const line of lines) opts.onLine?.(line, stream);
		};

		child.stdout.on('data', (d: Buffer) => {
			const s = d.toString();
			stdout += s;
			pump(s, 'stdout');
			pushTail(s);
		});
		child.stderr.on('data', (d: Buffer) => {
			const s = d.toString();
			pump(s, 'stderr');
			pushTail(s);
		});

		const timer = opts.timeoutMs
			? setTimeout(() => child.kill('SIGKILL'), opts.timeoutMs)
			: null;

		child.on('error', (err) => {
			if (timer) clearTimeout(timer);
			const msg = /ENOENT/.test(String(err))
				? `yt-dlp not found (looked for "${config.ytdlpPath}"). Is it installed / on PATH?`
				: `yt-dlp failed to start: ${err.message}`;
			reject(new YtDlpError(msg, tailLines.join('\n'), null));
		});
		child.on('close', (code) => {
			if (timer) clearTimeout(timer);
			if (stdoutBuf) opts.onLine?.(stdoutBuf, 'stdout');
			if (code === 0) resolve({ stdout, tail: tailLines.join('\n') });
			else reject(new YtDlpError(`yt-dlp exited ${code}`, tailLines.join('\n'), code));
		});
	});
}

function cookieArgs(): string[] {
	return fs.existsSync(config.cookiesPath) ? ['--cookies', config.cookiesPath] : [];
}

/* ------------------------------------------------------------------ probe */

/** Fetch metadata for a single video without downloading it. */
export async function probe(url: string): Promise<ProbeResult> {
	const { stdout } = await run(
		['-J', '--no-playlist', '--no-warnings', ...cookieArgs(), url],
		{ timeoutMs: 60_000 }
	);
	const info = JSON.parse(stdout) as RawInfo;
	return normalizeProbe(info);
}

export function normalizeProbe(info: RawInfo): ProbeResult {
	return {
		videoId: info.id,
		title: info.title ?? info.id,
		channelId: info.channel_id ?? info.uploader_id ?? null,
		channelName: info.channel ?? info.uploader ?? null,
		durationSeconds: info.duration ?? null,
		thumbnail: info.thumbnail ?? null,
		uploadDate: parseUploadDate(info.upload_date),
		description: info.description ?? null,
		isLive: !!info.is_live,
		wasLive: !!info.was_live
	};
}

/** Resolve a channel id from any channel URL / handle / video URL. */
export async function resolveChannelId(url: string): Promise<string | null> {
	const { stdout } = await run(
		['--skip-download', '--playlist-items', '1', '--print', '%(channel_id)s', '--no-warnings', ...cookieArgs(), url],
		{ timeoutMs: 60_000 }
	);
	const id = stdout.trim().split('\n')[0]?.trim();
	return id && id !== 'NA' && /^UC[\w-]{20,}$/.test(id) ? id : null;
}

/** Expand a playlist into its entries (flat — no per-video network calls). */
export async function probePlaylist(url: string): Promise<PlaylistEntry[]> {
	const { stdout } = await run(
		['--flat-playlist', '-J', '--no-warnings', ...cookieArgs(), url],
		{ timeoutMs: 120_000 }
	);
	const data = JSON.parse(stdout) as { entries?: RawInfo[] };
	return (data.entries ?? [])
		.filter((e) => e?.id)
		.map((e) => ({
			videoId: e.id,
			title: e.title ?? e.id,
			channelName: e.channel ?? e.uploader ?? null,
			durationSeconds: e.duration ?? null
		}));
}

/* --------------------------------------------------------------- download */

function formatSelector(maxHeight: number, preferH264: boolean): string {
	const h = maxHeight;
	if (preferH264) {
		return [
			`bv*[height<=${h}][vcodec^=avc1]+ba[acodec^=mp4a]`,
			`bv*[height<=${h}][ext=mp4]+ba[ext=m4a]`,
			`bv*[height<=${h}]+ba`,
			`b[height<=${h}]`,
			'b'
		].join('/');
	}
	return [`bv*[height<=${h}]+ba`, `b[height<=${h}]`, 'b'].join('/');
}

export interface DownloadOptions {
	url: string;
	targetDir: string;
	maxHeight: number;
	preferH264: boolean;
	subLangs?: string;
	/** Categories to physically cut from the file (yt-dlp --sponsorblock-remove). */
	sponsorblockRemove?: string[];
	onProgress?: (p: DownloadProgress) => void;
	signal?: AbortSignal;
}

/** Download a video + thumbnail + subs + info.json into targetDir/video.*. */
export async function downloadVideo(opts: DownloadOptions): Promise<DownloadResult> {
	fs.mkdirSync(opts.targetDir, { recursive: true });
	const outTemplate = path.join(opts.targetDir, 'video.%(ext)s');

	const args = [
		opts.url,
		'-f', formatSelector(opts.maxHeight, opts.preferH264),
		'--merge-output-format', 'mp4',
		'--remux-video', 'mp4',
		'-o', outTemplate,
		'--write-info-json',
		'--write-thumbnail',
		'--convert-thumbnails', 'jpg',
		'--write-subs',
		'--write-auto-subs',
		'--sub-langs', opts.subLangs ?? 'en.*',
		'--convert-subs', 'vtt',
		'--no-playlist',
		'--no-colors',
		'--newline',
		'--continue',
		'--retries', '3',
		'--fragment-retries', '10',
		'--progress-template',
		'download:HAYPROG|%(progress._percent_str)s|%(progress._speed_str)s|%(progress._eta_str)s',
		...(opts.sponsorblockRemove?.length
			? ['--sponsorblock-remove', opts.sponsorblockRemove.join(',')]
			: []),
		...cookieArgs()
	];

	let stage = 'download';
	await run(args, {
		signal: opts.signal,
		timeoutMs: 6 * 60 * 60 * 1000, // 6h hard ceiling
		onLine: (line) => {
			const s = line.trim();
			if (s.startsWith('HAYPROG|')) {
				const [, pct, speed, eta] = s.split('|');
				opts.onProgress?.({
					percent: clampPercent(pct),
					speed: cleanField(speed),
					eta: cleanField(eta),
					stage
				});
			} else if (s.startsWith('[Merger]')) {
				stage = 'merge';
				opts.onProgress?.({ percent: 1, speed: null, eta: null, stage });
			} else if (s.startsWith('[SubtitlesConvertor]') || s.includes('Converting subtitles')) {
				stage = 'subtitles';
			} else if (s.startsWith('[ThumbnailsConvertor]')) {
				stage = 'thumbnail';
			}
		}
	});

	return collectOutputs(opts.targetDir);
}

/** After a download, locate the produced files and read info.json. */
export function collectOutputs(dir: string): DownloadResult {
	const files = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
	const find = (pred: (f: string) => boolean) => {
		const f = files.find(pred);
		return f ? path.join(dir, f) : null;
	};

	const videoPath =
		find((f) => f === 'video.mp4') ??
		find((f) => /^video\.(mp4|mkv|webm|m4v|mov)$/.test(f));
	const thumbnailPath = find((f) => /^video\.(jpg|jpeg|png|webp)$/.test(f));
	const subtitlePath =
		find((f) => /^video\.en(-orig)?\.vtt$/.test(f)) ?? find((f) => /^video\.en.*\.vtt$/.test(f));
	const infoJsonPath = find((f) => f === 'video.info.json');

	let info: RawInfo | null = null;
	if (infoJsonPath) {
		try {
			info = JSON.parse(fs.readFileSync(infoJsonPath, 'utf-8')) as RawInfo;
		} catch {
			info = null;
		}
	}

	return { videoPath, thumbnailPath, subtitlePath, infoJsonPath, info };
}

export function chaptersFromInfo(info: RawInfo | null): Chapter[] | null {
	if (!info?.chapters?.length) return null;
	return info.chapters.map((c) => ({
		title: c.title ?? '',
		startTime: c.start_time,
		endTime: c.end_time
	}));
}

/* -------------------------------------------------------------- versioning */

export async function getVersion(): Promise<string> {
	const { stdout } = await run(['--version'], { timeoutMs: 15_000 });
	return stdout.trim();
}

/** Self-update yt-dlp in place (`yt-dlp -U`). Returns the resulting version. */
export async function selfUpdate(): Promise<string> {
	await run(['-U'], { timeoutMs: 120_000 });
	return getVersion();
}

/**
 * Tell YouTube a video was watched. yt-dlp fetches the player response and
 * pings the `videostats` playback/watchtime URLs exactly like the real player —
 * far more durable than hand-rolling InnerTube calls. Requires cookies.
 */
export async function markWatchedRemote(url: string): Promise<void> {
	if (!fs.existsSync(config.cookiesPath)) throw new Error('history sync requires cookies.txt');
	await run(
		['--simulate', '--skip-download', '--mark-watched', '--no-warnings', ...cookieArgs(), url],
		{ timeoutMs: 60_000 }
	);
}

/* ---------------------------------------------------------------- helpers */

function parseUploadDate(d: string | undefined): Date | null {
	if (!d || !/^\d{8}$/.test(d)) return null;
	const y = +d.slice(0, 4);
	const m = +d.slice(4, 6);
	const day = +d.slice(6, 8);
	return new Date(Date.UTC(y, m - 1, day));
}

function clampPercent(raw: string | undefined): number {
	const n = Number.parseFloat((raw ?? '').replace('%', '').trim());
	if (!Number.isFinite(n)) return 0;
	return Math.max(0, Math.min(1, n / 100));
}

function cleanField(raw: string | undefined): string | null {
	const s = (raw ?? '').trim();
	return !s || s === 'NA' || s === 'Unknown' ? null : s;
}

export { YtDlpError, parseUploadDate };
