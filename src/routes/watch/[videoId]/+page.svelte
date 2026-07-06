<script lang="ts">
	import { formatDuration, formatRelative } from '$lib/format';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	let video: HTMLVideoElement | undefined = $state();

	// Bare player for Phase 2 — native controls + resume + subtitles.
	// Phase 3 replaces this with the custom player (chapters, SponsorBlock,
	// keyboard shortcuts, theater mode).
	function onLoaded() {
		if (data.playable && video && data.video.positionSeconds > 5) {
			video.currentTime = data.video.positionSeconds;
		}
	}
</script>

<svelte:head>
	<title>{data.video.title} · Haystack</title>
</svelte:head>

{#if !data.playable}
	<EmptyState
		icon="downloads"
		title="Not ready to play yet"
		hint="This video is still {data.video.status === 'failed' ? 'marked failed — check the Downloads page' : 'downloading'}."
	/>
{:else}
	<div class="mx-auto max-w-5xl">
		<div class="overflow-hidden rounded-xl bg-black">
			<!-- svelte-ignore a11y_media_has_caption -->
			<video
				bind:this={video}
				class="aspect-video w-full"
				controls
				autoplay
				poster="/api/thumb/{data.video.videoId}"
				onloadedmetadata={onLoaded}
			>
				<source src="/api/stream/{data.video.videoId}" type="video/mp4" />
				{#if data.video.hasSubtitles}
					<track kind="subtitles" src="/api/subs/{data.video.videoId}" srclang="en" label="English" default />
				{/if}
			</video>
		</div>

		<h1 class="mt-4 text-xl font-semibold">{data.video.title}</h1>
		<div class="mt-1 flex items-center gap-3 text-sm text-fg-muted">
			{#if data.video.channelName}
				<a href="/channels" class="hover:text-fg">{data.video.channelName}</a>
			{/if}
			{#if data.video.durationSeconds}<span>· {formatDuration(data.video.durationSeconds)}</span>{/if}
			{#if data.video.uploadDate}<span>· {formatRelative(data.video.uploadDate)}</span>{/if}
		</div>

		{#if data.video.description}
			<div class="card mt-4 whitespace-pre-wrap p-4 text-sm leading-relaxed text-fg-muted">
				{data.video.description}
			</div>
		{/if}
	</div>
{/if}
