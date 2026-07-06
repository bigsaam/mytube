import { bus } from '$lib/server/events';
import { listDownloads } from '$lib/server/library';
import type { RequestHandler } from './$types';

/**
 * Server-Sent Events stream of the download queue. Emits a full snapshot on
 * connect and on every change (debounced), so the Downloads page stays live
 * without polling.
 */
export const GET: RequestHandler = () => {
	let debounce: ReturnType<typeof setTimeout> | null = null;
	let heartbeat: ReturnType<typeof setInterval> | null = null;
	let closed = false;
	const enc = new TextEncoder();
	const onUpdate = () => {
		if (debounce) return; // coalesce a burst of progress ticks
		debounce = setTimeout(() => {
			debounce = null;
			push();
		}, 250);
	};
	let push = () => {};
	let cleanup = () => {};

	const stream = new ReadableStream({
		start(controller) {
			push = () => {
				if (closed) return;
				try {
					controller.enqueue(enc.encode(`data: ${JSON.stringify(listDownloads())}\n\n`));
				} catch {
					cleanup();
				}
			};
			cleanup = () => {
				if (closed) return;
				closed = true;
				if (debounce) clearTimeout(debounce);
				if (heartbeat) clearInterval(heartbeat);
				bus.off('download:update', onUpdate);
				try {
					controller.close();
				} catch {
					/* already closed */
				}
			};

			push(); // initial snapshot
			heartbeat = setInterval(() => {
				if (!closed) controller.enqueue(enc.encode(': ping\n\n'));
			}, 20_000);
			bus.on('download:update', onUpdate);
		},
		cancel() {
			cleanup();
		}
	});

	return new Response(stream, {
		headers: {
			'content-type': 'text/event-stream',
			'cache-control': 'no-cache, no-transform',
			connection: 'keep-alive'
		}
	});
};
