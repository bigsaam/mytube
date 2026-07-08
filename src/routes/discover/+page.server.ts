import { listRecommendations } from '$lib/server/discover';
import { config } from '$lib/server/config';
import type { PageServerLoad } from './$types';

const PAGE_SIZE = 48;

export const load: PageServerLoad = () => {
	return {
		items: listRecommendations({ limit: PAGE_SIZE }),
		pageSize: PAGE_SIZE,
		feedEnabled: config.recommendedFeedEnabled
	};
};
