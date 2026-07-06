<script lang="ts">
	import Icon from './Icon.svelte';
	import { formatDuration } from '$lib/format';

	interface Props {
		videoId: string;
		title: string;
		channelName?: string | null;
		durationSeconds?: number | null;
		thumbnailUrl?: string | null;
		href?: string;
		watched?: boolean;
		/** 0..1 resume progress bar under the thumbnail. */
		progress?: number;
		/** Small status pill, e.g. 'downloading', 'failed'. */
		status?: string | null;
	}
	let {
		videoId,
		title,
		channelName,
		durationSeconds,
		thumbnailUrl,
		href,
		watched = false,
		progress = 0,
		status = null
	}: Props = $props();

	let link = $derived(href ?? `/watch/${videoId}`);
	let duration = $derived(formatDuration(durationSeconds));
</script>

<a href={link} class="group block">
	<div class="relative aspect-video overflow-hidden rounded-xl bg-bg-raised">
		{#if thumbnailUrl}
			<img
				src={thumbnailUrl}
				alt=""
				loading="lazy"
				class="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.02]"
			/>
		{:else}
			<div class="grid h-full w-full place-items-center text-fg-faint">
				<Icon name="play" size={28} />
			</div>
		{/if}

		{#if duration}
			<span class="absolute bottom-1.5 right-1.5 rounded bg-black/80 px-1.5 py-0.5 text-xs font-medium tabular-nums text-white">
				{duration}
			</span>
		{/if}

		{#if status && status !== 'ready'}
			<span class="absolute left-1.5 top-1.5 chip bg-black/70 capitalize text-white">{status}</span>
		{/if}

		{#if watched}
			<span class="absolute left-1.5 top-1.5 grid h-6 w-6 place-items-center rounded-full bg-black/70 text-accent">
				<Icon name="check" size={14} />
			</span>
		{/if}

		{#if progress > 0.01 && progress < 0.99}
			<div class="absolute inset-x-0 bottom-0 h-1 bg-black/40">
				<div class="h-full bg-accent" style="width: {Math.round(progress * 100)}%"></div>
			</div>
		{/if}
	</div>

	<div class="mt-2 px-0.5">
		<h3 class="line-clamp-2 text-sm font-medium leading-snug text-fg group-hover:text-white">
			{title}
		</h3>
		{#if channelName}
			<p class="mt-0.5 truncate text-xs text-fg-muted">{channelName}</p>
		{/if}
	</div>
</a>
