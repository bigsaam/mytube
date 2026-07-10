<script lang="ts">
	import PageHeader from '$lib/components/PageHeader.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import FeedCard from '$lib/components/FeedCard.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import { goto, invalidateAll } from '$app/navigation';
	import type { PageData } from './$types';
	import type { DiscoverCard } from '$lib/server/discover';

	let { data }: { data: PageData } = $props();
	let items = $state<DiscoverCard[]>(data.items);
	$effect(() => {
		items = data.items;
	});

	let loading = $state(false);
	let done = $state(data.items.length < data.pageSize);
	let toast = $state<string | null>(null);
	function flash(msg: string) {
		toast = msg;
		setTimeout(() => (toast = null), 2500);
	}

	async function onAction(id: number, action: 'grab' | 'watchLater' | 'dismiss') {
		items = items.filter((i) => i.id !== id);
		try {
			const res = await fetch('/api/recommended', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ id, action })
			});
			if (!res.ok) throw new Error();
			flash(action === 'dismiss' ? 'Dismissed' : action === 'watchLater' ? 'Grabbing → Watch Later' : 'Grabbing');
		} catch {
			flash('Something went wrong');
		}
	}

	/**
	 * Stream-and-discard: grab it as `ephemeral`, then go straight to the watch
	 * page (which renders the still-downloading state). The cleanup sweep prunes it
	 * once watched, unless the user hits Keep there.
	 */
	async function onWatchNow(id: number) {
		try {
			const res = await fetch('/api/recommended', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ id, action: 'watchNow' })
			});
			if (!res.ok) throw new Error();
			const { videoId } = (await res.json()) as { videoId: string };
			await goto(`/watch/${videoId}`);
		} catch {
			flash('Something went wrong');
		}
	}

	/**
	 * "Not interested": drop the card, and drop every other card from the same
	 * channel — the server blocks the channel, so leaving its siblings on screen
	 * would just be a lie the next reload corrects.
	 */
	async function onNotInterested(id: number) {
		const gone = items.find((i) => i.id === id);
		const channel = gone?.channelName ?? null;
		items = items.filter((i) => i.id !== id && !(channel && i.channelName === channel));
		try {
			const res = await fetch('/api/recommended', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ id, action: 'notInterested' })
			});
			if (!res.ok) throw new Error();
			flash(channel ? `Hidden — no more from ${channel}` : 'Hidden');
		} catch {
			flash('Something went wrong');
		}
	}

	/** Seed the pool from this card's related rail. Rate-capped server-side. */
	async function onMoreLikeThis(id: number, videoId: string) {
		try {
			const res = await fetch('/api/recommended', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ id, videoId, action: 'moreLikeThis' })
			});
			const body = (await res.json()) as { status: string; message: string };
			flash(body.message);
			// The scrape is async (Playwright ~20s); pull the fuller pool afterwards.
			if (body.status === 'queued') setTimeout(() => invalidateAll(), 25_000);
		} catch {
			flash('Could not fetch more like this');
		}
	}

	let refreshing = $state(false);
	async function refresh() {
		if (refreshing) return;
		refreshing = true;
		try {
			const res = await fetch('/api/recommended/refresh', { method: 'POST' });
			const body = (await res.json()) as { status: string; message: string };
			flash(body.message);
			// A scrape is async (Playwright ~10–20s). Pull the new pool shortly after.
			if (body.status === 'queued') {
				setTimeout(() => invalidateAll(), 18_000);
			}
		} catch {
			flash('Refresh failed');
		} finally {
			refreshing = false;
		}
	}

	async function loadMore() {
		if (loading || done || !items.length) return;
		loading = true;
		try {
			const before = items[items.length - 1].id;
			const res = await fetch(`/api/recommended?before=${before}&limit=${data.pageSize}`);
			const body = (await res.json()) as { items: DiscoverCard[] };
			const seen = new Set(items.map((i) => i.id));
			const fresh = (body.items ?? []).filter((i) => !seen.has(i.id));
			items = [...items, ...fresh];
			if (fresh.length < data.pageSize) done = true;
		} catch {
			flash('Could not load more');
		} finally {
			loading = false;
		}
	}
</script>

<div class="flex items-start justify-between gap-4">
	<PageHeader title="Discover" subtitle="Recommended for you — pulled from your YouTube home, ad- and sponsor-free" />
	<button class="btn-ghost mt-1 shrink-0" onclick={refresh} disabled={refreshing} title="Fetch fresh recommendations now">
		<Icon name="retry" size={15} /> {refreshing ? 'Refreshing…' : 'Refresh'}
	</button>
</div>

{#if items.length === 0}
	<EmptyState
		icon="discover"
		title="No recommendations yet"
		hint={data.feedEnabled
			? 'The recommended feed runs a few times a day. Upload your YouTube cookies in Settings if you haven’t, then check back.'
			: 'Enable the recommended feed (RECOMMENDED_FEED_ENABLED) and upload your YouTube cookies to start seeing recommendations.'}
	/>
{:else}
	<div class="grid grid-cols-1 gap-x-4 gap-y-6 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
		{#each items as item (item.id)}
			<FeedCard
				id={item.id}
				videoId={item.videoId}
				title={item.title}
				channelName={item.channelName}
				durationSeconds={item.durationSeconds}
				thumbnailUrl={item.thumbnailUrl}
				{onAction}
				{onWatchNow}
				{onNotInterested}
				{onMoreLikeThis}
			/>
		{/each}
	</div>

	{#if !done}
		<div class="mt-8 flex justify-center">
			<button class="btn-ghost" onclick={loadMore} disabled={loading}>
				{loading ? 'Loading…' : 'Load more'}
			</button>
		</div>
	{/if}
{/if}

{#if toast}
	<div class="fixed bottom-6 left-1/2 -translate-x-1/2 rounded-lg bg-bg-raised px-4 py-2 text-sm shadow-xl">
		{toast}
	</div>
{/if}
