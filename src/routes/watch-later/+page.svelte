<script lang="ts">
	import PageHeader from '$lib/components/PageHeader.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import { formatDuration } from '$lib/format';
	import { enhance } from '$app/forms';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	let items = $state(data.items);
	$effect(() => {
		items = data.items;
	});

	let dragIndex = $state<number | null>(null);

	function onDragStart(i: number) {
		dragIndex = i;
	}
	function onDragOver(e: DragEvent, i: number) {
		e.preventDefault();
		if (dragIndex === null || dragIndex === i) return;
		const next = [...items];
		const [moved] = next.splice(dragIndex, 1);
		next.splice(i, 0, moved);
		items = next;
		dragIndex = i;
	}
	async function onDrop() {
		dragIndex = null;
		await fetch('/api/watch-later/reorder', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ order: items.map((i) => i.videoId) })
		}).catch(() => {});
	}
</script>

<PageHeader title="Watch Later" subtitle="Drag to reorder · {items.length} queued" />

{#if items.length === 0}
	<EmptyState icon="watch-later" title="Nothing queued" hint="Grab a video to Watch Later from the feed or the quick-add box." />
{:else}
	<ul class="flex flex-col gap-2">
		{#each items as item, i (item.videoId)}
			<li
				class="card flex items-center gap-3 p-2 pr-4 {dragIndex === i ? 'ring-1 ring-accent' : ''}"
				draggable="true"
				ondragstart={() => onDragStart(i)}
				ondragover={(e) => onDragOver(e, i)}
				ondragend={onDrop}
				role="listitem"
			>
				<span class="cursor-grab px-1 text-fg-faint" title="Drag to reorder">⠿</span>
				<span class="w-5 text-center text-sm tabular-nums text-fg-faint">{i + 1}</span>

				<a href="/watch/{item.videoId}?list=wl" class="relative aspect-video w-40 shrink-0 overflow-hidden rounded-lg bg-bg-raised">
					{#if item.status === 'ready' && !item.filesDeleted}
						<img src="/api/thumb/{item.videoId}" alt="" class="h-full w-full object-cover" />
					{:else}
						<div class="grid h-full w-full place-items-center text-fg-faint"><Icon name="play" size={20} /></div>
					{/if}
					{#if item.durationSeconds}
						<span class="absolute bottom-1 right-1 rounded bg-black/80 px-1 py-0.5 text-[10px] tabular-nums text-white">{formatDuration(item.durationSeconds)}</span>
					{/if}
				</a>

				<div class="min-w-0 flex-1">
					<a href="/watch/{item.videoId}?list=wl" class="line-clamp-2 text-sm font-medium hover:text-white">{item.title}</a>
					<p class="truncate text-xs text-fg-muted">
						{item.channelName}
						{#if item.status !== 'ready'}<span class="ml-1 capitalize text-fg-faint">· {item.status}</span>{/if}
					</p>
				</div>

				<form method="POST" action="?/remove" use:enhance>
					<input type="hidden" name="videoId" value={item.videoId} />
					<button class="btn-ghost px-2 py-1.5" type="submit" title="Remove from Watch Later"><Icon name="x" size={16} /></button>
				</form>
			</li>
		{/each}
	</ul>
{/if}
