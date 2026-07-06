import { error } from '@sveltejs/kit';
import { getVideo } from '$lib/server/library';
import { isVideoId } from '$lib/server/slug';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ params }) => {
	if (!isVideoId(params.videoId)) error(400, 'Bad video id');
	const video = getVideo(params.videoId);
	if (!video) error(404, 'Video not found');
	if (video.status !== 'ready' || video.filesDeleted) {
		return { video, playable: false as const };
	}
	return {
		playable: true as const,
		video: {
			videoId: video.videoId,
			title: video.title,
			description: video.description,
			channelName: video.channelName,
			channelId: video.channelId,
			durationSeconds: video.durationSeconds,
			uploadDate: video.uploadDate,
			hasSubtitles: !!video.subtitlePath,
			chapters: video.chapters ?? [],
			sponsorblock: video.sponsorblock ?? [],
			positionSeconds: video.positionSeconds,
			watched: video.watched
		}
	};
};
