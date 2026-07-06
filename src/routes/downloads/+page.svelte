<script lang="ts">
	import { onMount } from 'svelte';
	import { invalidateAll } from '$app/navigation';
	import { enhance } from '$app/forms';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let active = $derived(
		data.downloads.filter((d) => d.status === 'active' || d.status === 'queued')
	);

	// Phase 2: poll while work is in flight. Phase 5 swaps this for SSE.
	onMount(() => {
		const t = setInterval(() => {
			if (active.length > 0) invalidateAll();
		}, 2000);
		return () => clearInterval(t);
	});

	const statusColor: Record<string, string> = {
		active: 'text-accent',
		queued: 'text-fg-muted',
		failed: 'text-red-400',
		done: 'text-green-400',
		canceled: 'text-fg-faint'
	};
</script>

<PageHeader title="Downloads" subtitle="Queued, active, and failed jobs" />

{#if data.downloads.length === 0}
	<EmptyState icon="downloads" title="No downloads" hint="Grab a video to see live progress here." />
{:else}
	<div class="flex flex-col gap-2">
		{#each data.downloads as d (d.id)}
			<div class="card flex items-center gap-4 p-4">
				<div class="min-w-0 flex-1">
					<div class="flex items-center gap-2">
						<a href="/watch/{d.videoId}" class="truncate font-medium hover:text-white">{d.title}</a>
						<span class="chip capitalize {statusColor[d.status] ?? ''}">{d.status}</span>
						{#if d.attempts > 0 && d.status !== 'done'}
							<span class="text-xs text-fg-faint">attempt {d.attempts + 1}/{d.maxAttempts}</span>
						{/if}
					</div>

					{#if d.status === 'active'}
						<div class="mt-2 h-1.5 overflow-hidden rounded-full bg-bg-raised">
							<div class="h-full bg-accent transition-all" style="width:{Math.round(d.progress * 100)}%"></div>
						</div>
						<div class="mt-1 flex gap-3 text-xs text-fg-muted tabular-nums">
							<span>{Math.round(d.progress * 100)}%</span>
							{#if d.stage}<span class="capitalize">{d.stage}</span>{/if}
							{#if d.speed}<span>{d.speed}</span>{/if}
							{#if d.eta}<span>ETA {d.eta}</span>{/if}
						</div>
					{/if}

					{#if d.status === 'failed' && d.error}
						<pre class="mt-2 max-h-24 overflow-auto rounded-md bg-bg p-2 text-xs text-red-300/90">{d.error.split('\n').slice(-4).join('\n')}</pre>
					{/if}
				</div>

				{#if d.status === 'failed'}
					<form method="POST" action="?/retry" use:enhance>
						<input type="hidden" name="id" value={d.id} />
						<button class="btn-ghost" type="submit" title="Retry">
							<Icon name="retry" size={16} /> Retry
						</button>
					</form>
				{/if}
			</div>
		{/each}
	</div>
{/if}
