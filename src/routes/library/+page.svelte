<script lang="ts">
	import PageHeader from '$lib/components/PageHeader.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import VideoCard from '$lib/components/VideoCard.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import { goto } from '$app/navigation';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	let q = $state(data.search);

	function search(e: SubmitEvent) {
		e.preventDefault();
		const params = new URLSearchParams();
		if (q.trim()) params.set('q', q.trim());
		goto(`/library?${params}`, { keepFocus: true });
	}
</script>

<PageHeader title="Library" subtitle="Everything you've downloaded">
	<form onsubmit={search} class="relative">
		<Icon name="search" size={16} class="pointer-events-none absolute left-3 top-2.5 text-fg-faint" />
		<input class="input w-64 pl-9" placeholder="Search title / channel…" bind:value={q} />
	</form>
</PageHeader>

{#if data.videos.length === 0}
	<EmptyState
		icon="library"
		title={data.search ? `No matches for “${data.search}”` : 'Your library is empty'}
		hint={data.search ? undefined : "Grab a video and it'll appear here once downloaded."}
	/>
{:else}
	<div class="grid grid-cols-1 gap-x-4 gap-y-6 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
		{#each data.videos as v (v.videoId)}
			<VideoCard
				videoId={v.videoId}
				title={v.title}
				channelName={v.channelName}
				durationSeconds={v.durationSeconds}
				thumbnailUrl={v.status === 'ready' && !v.filesDeleted ? `/api/thumb/${v.videoId}` : null}
				watched={v.watched}
				progress={v.progress}
				status={v.status}
			/>
		{/each}
	</div>
{/if}
