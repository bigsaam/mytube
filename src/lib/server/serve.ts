import fs from 'node:fs';
import { Readable } from 'node:stream';
import { error } from '@sveltejs/kit';

/**
 * Serve a file with correct HTTP range-request support so <video> seeking and
 * mobile Safari work. Returns 206 for ranged requests, 200 otherwise, and 416
 * for an unsatisfiable range.
 */
export function serveFile(
	absPath: string,
	request: Request,
	contentType: string,
	opts: { cache?: string; filename?: string } = {}
): Response {
	let stat: fs.Stats;
	try {
		stat = fs.statSync(absPath);
	} catch {
		error(404, 'Not found');
	}
	if (!stat.isFile()) error(404, 'Not found');

	const size = stat.size;
	const range = request.headers.get('range');
	const baseHeaders: Record<string, string> = {
		'content-type': contentType,
		'accept-ranges': 'bytes',
		'cache-control': opts.cache ?? 'public, max-age=3600'
	};
	if (opts.filename) {
		baseHeaders['content-disposition'] = `inline; filename="${opts.filename}"`;
	}

	if (!range) {
		if (request.method === 'HEAD') {
			return new Response(null, { headers: { ...baseHeaders, 'content-length': String(size) } });
		}
		return new Response(toWeb(fs.createReadStream(absPath)), {
			status: 200,
			headers: { ...baseHeaders, 'content-length': String(size) }
		});
	}

	const parsed = parseRange(range, size);
	if (!parsed) {
		return new Response(null, {
			status: 416,
			headers: { 'content-range': `bytes */${size}`, 'accept-ranges': 'bytes' }
		});
	}
	const { start, end } = parsed;
	return new Response(toWeb(fs.createReadStream(absPath, { start, end })), {
		status: 206,
		headers: {
			...baseHeaders,
			'content-range': `bytes ${start}-${end}/${size}`,
			'content-length': String(end - start + 1)
		}
	});
}

function parseRange(header: string, size: number): { start: number; end: number } | null {
	const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
	if (!m) return null;
	const [, rawStart, rawEnd] = m;
	let start: number;
	let end: number;
	if (rawStart === '') {
		// suffix range: last N bytes
		const n = Number.parseInt(rawEnd, 10);
		if (!Number.isFinite(n) || n <= 0) return null;
		start = Math.max(0, size - n);
		end = size - 1;
	} else {
		start = Number.parseInt(rawStart, 10);
		end = rawEnd === '' ? size - 1 : Number.parseInt(rawEnd, 10);
	}
	if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
	if (start > end || start >= size) return null;
	end = Math.min(end, size - 1);
	return { start, end };
}

function toWeb(stream: fs.ReadStream): ReadableStream {
	return Readable.toWeb(stream) as unknown as ReadableStream;
}
