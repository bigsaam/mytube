import { listLibrary } from '$lib/server/library';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ url }) => {
	const search = url.searchParams.get('q')?.trim() || undefined;
	return { videos: listLibrary({ search }), search: search ?? '' };
};
