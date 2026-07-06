<script lang="ts">
	import PageHeader from '$lib/components/PageHeader.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import { enhance } from '$app/forms';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
	let selectedId = $state(data.settings.syncPlaylistId ?? '');
	let selectedTitle = $derived(data.playlists.find((p) => p.id === selectedId)?.title ?? '');
</script>

<PageHeader title="YouTube playlist sync" subtitle="Add on your phone → auto-download → auto-remove when watched">
	<a href="/settings" class="btn-ghost text-sm">← Settings</a>
</PageHeader>

{#if data.justConnected}<p class="mb-4 rounded-md bg-accent-soft px-3 py-2 text-sm text-accent">Connected to YouTube.</p>{/if}
{#if data.oauthError}<p class="mb-4 rounded-md bg-red-950 px-3 py-2 text-sm text-red-300">OAuth error: {data.oauthError}</p>{/if}
{#if form?.error}<p class="mb-4 rounded-md bg-red-950 px-3 py-2 text-sm text-red-300">{form.error}</p>{/if}
{#if form?.credsSaved}<p class="mb-4 rounded-md bg-accent-soft px-3 py-2 text-sm text-accent">Credentials saved — now connect.</p>{/if}
{#if form?.playlistSet}<p class="mb-4 rounded-md bg-accent-soft px-3 py-2 text-sm text-accent">Playlist selected — syncing now.</p>{/if}
{#if form?.syncing}<p class="mb-4 rounded-md bg-accent-soft px-3 py-2 text-sm text-accent">Sync queued — new items appear in Watch Later.</p>{/if}
{#if data.connectionError}<p class="mb-4 rounded-md bg-amber-950 px-3 py-2 text-sm text-amber-300">{data.connectionError}</p>{/if}

<!-- How it works -->
<div class="mb-6 rounded-lg border border-line bg-bg-soft p-4 text-sm text-fg-muted">
	<p class="mb-2 font-medium text-fg">How the loop works</p>
	<ol class="list-inside list-decimal space-y-1">
		<li>On your phone (any YouTube app): <strong>Save → your MyTube playlist</strong>.</li>
		<li>MyTube polls that playlist (~5 min), downloads new videos, and shows them in <a href="/watch-later" class="text-accent">Watch Later</a>.</li>
		<li>Watch here (sponsors cut, no ads). At {'≥'}90% it's marked watched…</li>
		<li>…and MyTube removes it from the playlist via the YouTube Data API.</li>
	</ol>
	<p class="mt-2 text-xs text-fg-faint">Note: YouTube's built-in “Watch Later” isn't reachable by the API — use a normal playlist you create.</p>
</div>

<div class="grid gap-6 lg:grid-cols-2">
	<!-- Step 1: OAuth credentials -->
	<section class="card p-5">
		<h2 class="mb-2 text-sm font-semibold uppercase tracking-wide text-fg-muted">1 · Google OAuth</h2>
		{#if data.status.connected}
			<p class="mb-3 flex items-center gap-2 text-sm text-accent"><Icon name="check" size={16} /> Connected</p>
			<form method="POST" action="?/disconnect" use:enhance>
				<button class="btn-ghost text-xs text-red-400/80" type="submit">Disconnect</button>
			</form>
		{:else}
			<p class="mb-3 text-xs text-fg-faint">
				In <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noreferrer" class="text-accent">Google Cloud Console</a>:
				create a project, enable <em>YouTube Data API v3</em>, create an OAuth <em>Web application</em> client, and add this redirect URI:
			</p>
			<code class="mb-3 block break-all rounded bg-bg p-2 text-xs text-fg">{data.redirectUri}</code>
			<form method="POST" action="?/saveCreds" use:enhance class="flex flex-col gap-2">
				<input class="input" name="clientId" placeholder="Client ID" autocomplete="off" />
				<input class="input" name="clientSecret" type="password" placeholder="Client secret" autocomplete="off" />
				<button class="btn-primary" type="submit">Save credentials</button>
			</form>
			{#if data.status.hasClientCreds}
				<a href="/api/google/connect" class="btn-accent mt-3 w-full" data-sveltekit-reload>Connect YouTube account →</a>
			{/if}
		{/if}
	</section>

	<!-- Step 2: pick playlist -->
	<section class="card p-5">
		<h2 class="mb-2 text-sm font-semibold uppercase tracking-wide text-fg-muted">2 · Queue playlist</h2>
		{#if !data.status.connected}
			<p class="text-sm text-fg-faint">Connect your account first.</p>
		{:else}
			<form method="POST" action="?/selectPlaylist" use:enhance class="flex flex-col gap-2">
				<select class="input" name="playlistId" bind:value={selectedId}>
					<option value="" disabled>Choose a playlist…</option>
					{#each data.playlists as p (p.id)}
						<option value={p.id}>{p.title} ({p.itemCount})</option>
					{/each}
				</select>
				<input type="hidden" name="playlistTitle" value={selectedTitle} />
				<button class="btn-primary" type="submit" disabled={!selectedId}>Use this playlist</button>
			</form>

			{#if data.settings.syncPlaylistId}
				<div class="mt-4 rounded-lg bg-bg p-3 text-sm">
					<div class="flex items-center justify-between">
						<span>Syncing: <strong>{data.settings.syncPlaylistTitle ?? data.settings.syncPlaylistId}</strong></span>
						<form method="POST" action="?/toggleSync" use:enhance>
							<input type="hidden" name="on" value={data.settings.playlistSyncEnabled ? '0' : '1'} />
							<button class="chip {data.settings.playlistSyncEnabled ? 'text-accent' : 'text-fg-faint'}" type="submit">
								{data.settings.playlistSyncEnabled ? 'On' : 'Off'}
							</button>
						</form>
					</div>
					<form method="POST" action="?/syncNow" use:enhance class="mt-2">
						<button class="btn-ghost text-xs" type="submit"><Icon name="retry" size={14} /> Sync now</button>
					</form>
				</div>
			{/if}
		{/if}
	</section>
</div>
