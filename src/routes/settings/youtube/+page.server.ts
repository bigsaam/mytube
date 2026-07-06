import { fail } from '@sveltejs/kit';
import { getSettings, updateSettings } from '$lib/server/settings';
import { authStatus, setClientCredentials, disconnect, redirectUri } from '$lib/server/google-auth';
import { listMyPlaylists, type MyPlaylist } from '$lib/server/youtube-api';
import { enqueueJob } from '$lib/server/jobs';
import type { PageServerLoad, Actions } from './$types';

export const load: PageServerLoad = async ({ url }) => {
	const status = authStatus();
	let playlists: MyPlaylist[] = [];
	let connectionError: string | null = null;
	if (status.connected) {
		try {
			playlists = await listMyPlaylists();
		} catch (e) {
			connectionError = e instanceof Error ? e.message : 'Could not list playlists';
		}
	}
	const s = getSettings();
	return {
		status,
		redirectUri: redirectUri(),
		playlists,
		connectionError,
		settings: {
			playlistSyncEnabled: s.playlistSyncEnabled,
			syncPlaylistId: s.syncPlaylistId,
			syncPlaylistTitle: s.syncPlaylistTitle,
			sponsorblockMode: s.sponsorblockMode
		},
		justConnected: url.searchParams.get('connected') === '1',
		oauthError: url.searchParams.get('error')
	};
};

export const actions: Actions = {
	saveCreds: async ({ request }) => {
		const form = await request.formData();
		const clientId = String(form.get('clientId') ?? '').trim();
		const clientSecret = String(form.get('clientSecret') ?? '').trim();
		if (!clientId || !clientSecret) return fail(400, { error: 'Enter both client ID and secret.' });
		setClientCredentials(clientId, clientSecret);
		return { credsSaved: true };
	},

	selectPlaylist: async ({ request }) => {
		const form = await request.formData();
		const id = String(form.get('playlistId') ?? '');
		const title = String(form.get('playlistTitle') ?? '');
		if (!id) return fail(400, { error: 'Pick a playlist.' });
		updateSettings({ syncPlaylistId: id, syncPlaylistTitle: title, playlistSyncEnabled: true });
		enqueueJob('playlist_sync', {}, { dedupeKey: 'playlist_sync' });
		return { playlistSet: true };
	},

	toggleSync: async ({ request }) => {
		const form = await request.formData();
		updateSettings({ playlistSyncEnabled: form.get('on') === '1' });
		return { ok: true };
	},

	syncNow: async () => {
		enqueueJob('playlist_sync', {}, { dedupeKey: 'playlist_sync' });
		return { syncing: true };
	},

	disconnect: async () => {
		disconnect();
		updateSettings({ playlistSyncEnabled: false, syncPlaylistId: null, syncPlaylistTitle: null });
		return { disconnected: true };
	}
};
