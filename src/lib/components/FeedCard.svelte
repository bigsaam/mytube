<script lang="ts">
	import Icon from './Icon.svelte';
	import { formatDuration, formatRelative } from '$lib/format';

	interface Props {
		id: number;
		videoId: string;
		title: string;
		channelName?: string | null;
		durationSeconds?: number | null;
		thumbnailUrl?: string | null;
		publishedAt?: Date | string | null;
		onAction: (id: number, action: 'grab' | 'watchLater' | 'dismiss') => void;
		/**
		 * Stream-and-discard. Optional: only Discover can watch-now, because only
		 * pooled recommendations are disposable. Omit it and the button is absent.
		 */
		onWatchNow?: (id: number) => void;
		/** Hide this video and block its channel. Discover-only, like onWatchNow. */
		onNotInterested?: (id: number) => void;
		/** Seed the pool from this video's related rail. Discover-only. */
		onMoreLikeThis?: (id: number, videoId: string) => void;
	}
	let {
		id,
		videoId,
		title,
		channelName,
		durationSeconds,
		thumbnailUrl,
		publishedAt,
		onAction,
		onWatchNow,
		onNotInterested,
		onMoreLikeThis
	}: Props = $props();

	let busy = $state(false);
	async function act(action: 'grab' | 'watchLater' | 'dismiss') {
		if (busy) return;
		busy = true;
		onAction(id, action);
	}
	function watchNow() {
		if (busy) return;
		busy = true;
		onWatchNow?.(id);
	}
	function notInterested() {
		if (busy) return;
		busy = true;
		onNotInterested?.(id);
	}
	// Doesn't remove the card — it *adds* to the pool, so the card stays put.
	function moreLikeThis() {
		onMoreLikeThis?.(id, videoId);
	}

	let published = $derived(publishedAt ? new Date(publishedAt) : null);
</script>

<div class="group flex flex-col" class:opacity-50={busy}>
	<a
		href={`https://www.youtube.com/watch?v=${videoId}`}
		target="_blank"
		rel="noreferrer"
		class="relative block aspect-video overflow-hidden rounded-xl bg-bg-raised"
		title="Preview on YouTube"
	>
		{#if thumbnailUrl}
			<img src={thumbnailUrl} alt="" loading="lazy" class="h-full w-full object-cover" />
		{:else}
			<div class="grid h-full w-full place-items-center text-fg-faint"><Icon name="play" size={26} /></div>
		{/if}
		{#if durationSeconds}
			<span class="absolute bottom-1.5 right-1.5 rounded bg-black/80 px-1.5 py-0.5 text-xs font-medium tabular-nums text-white">
				{formatDuration(durationSeconds)}
			</span>
		{/if}
	</a>

	<div class="mt-2 flex-1 px-0.5">
		<h3 class="line-clamp-2 text-sm font-medium leading-snug">{title}</h3>
		<p class="mt-0.5 truncate text-xs text-fg-muted">
			{channelName}{#if published}<span> · {formatRelative(published)}</span>{/if}
		</p>
	</div>

	<div class="mt-2 flex items-center gap-2">
		<button class="btn-accent flex-1 py-1.5 text-xs" onclick={() => act('grab')} disabled={busy}>
			<Icon name="grab" size={14} /> Grab
		</button>
		{#if onWatchNow}
			<button
				class="btn-ghost py-1.5 text-xs"
				onclick={watchNow}
				disabled={busy}
				title="Watch now (deleted after watching unless you Keep it)"
			>
				<Icon name="play" size={14} />
			</button>
		{/if}
		<button class="btn-ghost py-1.5 text-xs" onclick={() => act('watchLater')} disabled={busy} title="Grab + Watch Later">
			<Icon name="watch-later" size={14} />
		</button>
		{#if onMoreLikeThis}
			<button class="btn-ghost py-1.5 text-xs" onclick={moreLikeThis} disabled={busy} title="More like this — pull this video's recommendations into Discover">
				<Icon name="discover" size={14} />
			</button>
		{/if}
		<button class="btn-ghost py-1.5 text-xs" onclick={() => act('dismiss')} disabled={busy} title="Dismiss">
			<Icon name="x" size={14} />
		</button>
		{#if onNotInterested}
			<button class="btn-ghost py-1.5 text-xs" onclick={notInterested} disabled={busy} title="Not interested — hide this and stop showing this channel">
				<Icon name="block" size={14} />
			</button>
		{/if}
	</div>
</div>
