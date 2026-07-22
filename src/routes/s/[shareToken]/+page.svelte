<script lang="ts">
	import Player from '$lib/components/Player.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import Footer from '$lib/components/Footer.svelte';
	import Comments from '$lib/components/Comments.svelte';
	import { formatDuration, formatRelative, formatCount, parseDescription } from '$lib/format';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	let player = $state<{ seekTo: (t: number) => void }>();
	let descParts = $derived(
		data.playable && data.video.description ? parseDescription(data.video.description) : []
	);

	function jump(seconds: number | null) {
		if (seconds != null) player?.seekTo(seconds);
	}
</script>

<svelte:head>
	<title>{data.playable ? data.video.title : 'Shared video'} · MyTube</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<!-- Column layout so the footer pins to the bottom of the viewport even when the
     content is short (e.g. the "video isn't available" state). -->
<div class="flex min-h-screen flex-col bg-bg">
	<header class="flex h-14 shrink-0 items-center gap-2 border-b border-line px-6">
		<div class="grid h-7 w-7 place-items-center rounded-md bg-accent text-bg"><Icon name="play" size={16} /></div>
		<span class="font-semibold">MyTube</span>
		<span class="text-sm text-fg-faint">· shared video</span>
	</header>

	<div class="mx-auto w-full max-w-5xl flex-1 px-4 py-6">
		{#if !data.playable}
			<div class="card p-8 text-center text-fg-muted">
				<p class="text-lg font-medium">This video isn't available right now.</p>
				<p class="mt-1 text-sm text-fg-faint">The owner may have removed it from their library.</p>
			</div>
		{:else}
			<Player
				bind:this={player}
				share
				streamSrc={`/s/${data.shareToken}/stream`}
				posterSrc={`/s/${data.shareToken}/thumb`}
				subsSrc={`/s/${data.shareToken}/subs`}
				videoId={data.video.videoId}
				title={data.video.title}
				channelName={data.video.channelName}
				durationSeconds={data.video.durationSeconds}
				hasSubtitles={data.video.hasSubtitles}
				chapters={data.video.chapters}
				sponsorblock={data.video.sponsorblock}
				autoSkipDefault={data.autoSkipDefault}
			/>

			<h1 class="mt-4 text-xl font-semibold leading-snug">{data.video.title}</h1>
			<div class="mt-2 flex flex-wrap items-center gap-2 text-sm text-fg-muted">
				{#if data.video.channelName}<span class="font-medium text-fg">{data.video.channelName}</span>{/if}
				{#if data.video.durationSeconds}<span>· {formatDuration(data.video.durationSeconds)}</span>{/if}
				{#if data.video.uploadDate}<span>· {formatRelative(data.video.uploadDate)}</span>{/if}
				{#if data.video.viewCount != null}<span>· {formatCount(data.video.viewCount)} views</span>{/if}
				{#if data.video.likeCount != null}<span>· {formatCount(data.video.likeCount)} likes</span>{/if}
			</div>

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

			{#if data.video.description}
				<div class="card mt-4 whitespace-pre-wrap p-4 text-sm leading-relaxed text-fg-muted">
					{#each descParts as part, i (i)}
						{#if part.seconds != null}
							<button class="text-accent hover:underline" onclick={() => jump(part.seconds)}>{part.text}</button>
						{:else}{part.text}{/if}
					{/each}
				</div>
			{/if}

			<Comments comments={data.video.comments} totalCount={data.video.commentCount} />

			<p class="mt-8 text-center text-xs text-fg-faint">Shared from a private MyTube library.</p>
		{/if}
	</div>

	<div class="mx-auto w-full max-w-5xl shrink-0 px-4 pb-6">
		<div class="border-t border-line pt-6">
			<Footer />
		</div>
	</div>
</div>
