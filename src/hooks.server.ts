import type { Handle } from '@sveltejs/kit';
import { bootstrap } from '$lib/server/bootstrap';

// Runs once per process, before the first request is handled.
bootstrap();

export const handle: Handle = async ({ event, resolve }) => {
	return resolve(event);
};
