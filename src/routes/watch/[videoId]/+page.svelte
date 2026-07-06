<script lang="ts">
	import { formatDuration, formatRelative, parseDescription } from '$lib/format';
	import Player from '$lib/components/Player.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	let player = $state<{ seekTo: (t: number) => void }>();
	let theater = $state(false);

	let descParts = $derived(data.video.description ? parseDescription(data.video.description) : []);

	function jump(seconds: number | null) {
		if (seconds != null) player?.seekTo(seconds);
	}

	// Re-run the page load after a lifecycle action so the buttons reflect state.
	const refresh: SubmitFunction = () => ({ update }) => update({ reset: false });
</script>

<svelte:head><title>{data.video.title} · MyTube</title></svelte:head>

{#if !data.playable}
	<div class="mx-auto max-w-2xl">
		{#if data.video.cleaned}
			<EmptyState icon="trash" title="Files were cleaned up" hint="The history record is kept — you can re-download it." />
			<form method="POST" action="?/regrab" use:enhance={refresh} class="mt-4 flex justify-center">
				<input type="hidden" name="videoId" value={data.video.videoId} />
				<button class="btn-accent" type="submit"><Icon name="grab" size={16} /> Re-download</button>
			</form>
		{:else}
			<EmptyState
				icon="downloads"
				title="Not ready to play yet"
				hint={data.video.status === 'failed'
					? 'This download failed — check the Downloads page to retry.'
					: 'This video is still downloading — check back shortly.'}
			/>
		{/if}
	</div>
{:else}
	<div class="mx-auto {theater ? 'max-w-none' : 'max-w-5xl'}">
		<Player
			bind:this={player}
			bind:theater
			videoId={data.video.videoId}
			durationSeconds={data.video.durationSeconds}
			hasSubtitles={data.video.hasSubtitles}
			chapters={data.video.chapters}
			sponsorblock={data.video.sponsorblock}
			positionSeconds={data.video.positionSeconds}
			autoSkipDefault={data.autoSkipDefault}
		/>

		<div class="mx-auto {theater ? 'max-w-5xl' : ''}">
			<h1 class="mt-4 text-xl font-semibold leading-snug">{data.video.title}</h1>

			<div class="mt-2 flex flex-wrap items-center gap-3">
				<div class="flex items-center gap-2 text-sm text-fg-muted">
					{#if data.video.channelName}
						<a href="/channels" class="font-medium text-fg hover:text-white">{data.video.channelName}</a>
					{/if}
					{#if data.video.durationSeconds}<span>· {formatDuration(data.video.durationSeconds)}</span>{/if}
					{#if data.video.uploadDate}<span>· {formatRelative(data.video.uploadDate)}</span>{/if}
				</div>

				<div class="ml-auto flex items-center gap-2">
					<!-- Watched toggle -->
					<form method="POST" action={data.video.watched ? '?/unwatched' : '?/watched'} use:enhance={refresh}>
						<input type="hidden" name="videoId" value={data.video.videoId} />
						<button class="btn-ghost {data.video.watched ? 'text-accent' : ''}" type="submit">
							<Icon name="check" size={16} /> {data.video.watched ? 'Watched' : 'Mark watched'}
						</button>
					</form>

					<!-- Watch Later toggle -->
					<form method="POST" action="?/watchLater" use:enhance={refresh}>
						<input type="hidden" name="videoId" value={data.video.videoId} />
						<input type="hidden" name="add" value={data.video.inWatchLater ? '0' : '1'} />
						<button class="btn-ghost {data.video.inWatchLater ? 'text-accent' : ''}" type="submit" title="Watch Later">
							<Icon name="watch-later" size={16} />
						</button>
					</form>

					<!-- Pin (exempt from cleanup) -->
					<form method="POST" action="?/pin" use:enhance={refresh}>
						<input type="hidden" name="videoId" value={data.video.videoId} />
						<input type="hidden" name="pinned" value={data.video.pinned ? '0' : '1'} />
						<button class="btn-ghost {data.video.pinned ? 'text-accent' : ''}" type="submit" title="Pin (keep, exempt from cleanup)">
							<Icon name="pin" size={16} />
						</button>
					</form>

					<!-- History-sync opt-out (only when the integration is enabled) -->
					{#if data.historySyncEnabled}
						<form method="POST" action="?/historyOptout" use:enhance={refresh}>
							<input type="hidden" name="videoId" value={data.video.videoId} />
							<input type="hidden" name="optout" value={data.video.historySyncOptout ? '0' : '1'} />
							<button
								class="btn-ghost text-xs {data.video.historySyncOptout ? 'text-accent' : ''}"
								type="submit"
								title={data.video.historySyncOptout
									? 'History sync off for this video — click to re-enable'
									: 'Mark watched locally only (no YouTube history ping)'}
							>
								{data.video.historySyncOptout ? 'Local-only' : 'Syncs to YT'}
							</button>
						</form>
					{/if}
				</div>
			</div>

			<!-- Chapters -->
			{#if data.video.chapters.length > 0}
				<details class="card mt-4 p-4">
					<summary class="cursor-pointer text-sm font-medium">Chapters ({data.video.chapters.length})</summary>
					<ul class="mt-3 flex flex-col gap-1">
						{#each data.video.chapters as c (c.startTime)}
							<li>
								<button class="flex w-full items-center gap-3 rounded px-2 py-1 text-left text-sm hover:bg-bg-hover" onclick={() => jump(c.startTime)}>
									<span class="tabular-nums text-accent">{formatDuration(c.startTime)}</span>
									<span class="truncate text-fg-muted">{c.title}</span>
								</button>
							</li>
						{/each}
					</ul>
				</details>
			{/if}

			<!-- Description with clickable timestamps -->
			{#if data.video.description}
				<div class="card mt-4 whitespace-pre-wrap p-4 text-sm leading-relaxed text-fg-muted">
					{#each descParts as part, i (i)}
						{#if part.seconds != null}
							<button class="text-accent hover:underline" onclick={() => jump(part.seconds)}>{part.text}</button>
						{:else}{part.text}{/if}
					{/each}
				</div>
			{/if}
		</div>
	</div>
{/if}
