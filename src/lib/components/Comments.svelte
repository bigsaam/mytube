<script lang="ts">
	import { formatRelative, formatCount } from '$lib/format';
	import type { CommentThread, CommentNode } from '$lib/server/db/schema';

	interface Props {
		comments: CommentThread[];
		totalCount?: number | null;
	}
	let { comments, totalCount = null }: Props = $props();

	function initial(name: string): string {
		return (name.replace(/^@/, '')[0] ?? '?').toUpperCase();
	}
</script>

{#if comments.length}
	<section class="card mt-4 p-4">
		<h2 class="text-sm font-semibold">
			Comments{totalCount ? ` · ${formatCount(totalCount)}` : ''}
		</h2>
		<p class="mb-4 mt-0.5 text-xs text-fg-faint">Top comments, captured at download time.</p>
		<ul class="flex flex-col gap-4">
			{#each comments as c, i (i)}
				<li>
					{@render comment(c)}
					{#if c.replies.length}
						<ul class="mt-3 flex flex-col gap-3 border-l border-line pl-4">
							{#each c.replies as r, j (j)}
								<li>{@render comment(r)}</li>
							{/each}
						</ul>
					{/if}
				</li>
			{/each}
		</ul>
	</section>
{/if}

{#snippet comment(c: CommentNode)}
	<div class="flex gap-3">
		<div class="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-bg-hover text-xs font-semibold text-fg-muted">
			{initial(c.author)}
		</div>
		<div class="min-w-0 flex-1">
			<div class="flex flex-wrap items-center gap-x-2 text-xs text-fg-muted">
				<span class="font-medium {c.authorIsUploader ? 'rounded bg-accent-soft px-1 text-accent' : 'text-fg'}">{c.author}</span>
				{#if c.timestamp}<span>· {formatRelative(c.timestamp * 1000)}</span>{/if}
				{#if c.likeCount}<span>· ♥ {formatCount(c.likeCount)}</span>{/if}
			</div>
			<p class="mt-0.5 whitespace-pre-wrap break-words text-sm text-fg-muted">{c.text}</p>
		</div>
	</div>
{/snippet}
