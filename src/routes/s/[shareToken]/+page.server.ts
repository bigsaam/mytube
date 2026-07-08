import { error } from '@sveltejs/kit';
import { verifyShare } from '$lib/server/shares';
import { getVideo } from '$lib/server/library';
import { getSetting } from '$lib/server/settings';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ params }) => {
	const share = verifyShare(params.shareToken);
	// Unknown / revoked / expired links look identical to a missing one — never
	// confirm existence, and never leak anything but this one video's basics.
	if (!share) error(404, 'This link is unavailable');
	const video = getVideo(share.videoId);
	if (!video) error(404, 'This link is unavailable');

	if (video.status !== 'ready' || video.filesDeleted) {
		return { playable: false as const, title: video.title };
	}

	return {
		playable: true as const,
		shareToken: params.shareToken,
		autoSkipDefault: getSetting('sponsorblockAutoSkip'),
		video: {
			videoId: video.videoId,
			title: video.title,
			description: video.description,
			channelName: video.channelName,
			durationSeconds: video.durationSeconds,
			uploadDate: video.uploadDate,
			viewCount: video.viewCount,
			likeCount: video.likeCount,
			commentCount: video.commentCount,
			comments: video.comments ?? [],
			hasSubtitles: !!video.subtitlePath,
			chapters: video.chapters ?? [],
			sponsorblock: video.sponsorblock ?? []
		}
	};
};
