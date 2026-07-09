<script lang="ts">
	import PageHeader from '$lib/components/PageHeader.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import FeedCard from '$lib/components/FeedCard.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	// Local copy so acted-on items vanish immediately (optimistic).
	let items = $state(data.items);
	$effect(() => {
		items = data.items;
	});

	let toast = $state<string | null>(null);
	function flash(msg: string) {
		toast = msg;
		setTimeout(() => (toast = null), 2500);
	}

	async function onAction(id: number, action: 'grab' | 'watchLater' | 'dismiss') {
		items = items.filter((i) => i.id !== id);
		try {
			const res = await fetch('/api/feed', {
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
</script>

<PageHeader title="Feed" subtitle="New uploads from your channels — grab what you want" />

{#if items.length === 0}
	<EmptyState
		icon="feed"
		title={data.channelCount === 0 ? 'No channels yet' : "You're all caught up"}
		hint={data.channelCount === 0
			? 'Add channels to start seeing new uploads. Head to Channels.'
			: 'New uploads will appear here after the next poll.'}
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
				publishedAt={item.publishedAt}
				{onAction}
			/>
		{/each}
	</div>
{/if}

{#if toast}
	<div class="fixed bottom-6 left-1/2 -translate-x-1/2 rounded-lg bg-bg-raised px-4 py-2 text-sm shadow-xl">
		{toast}
	</div>
{/if}
