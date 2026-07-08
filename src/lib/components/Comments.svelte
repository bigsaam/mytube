<script lang="ts">
	import { formatRelative, formatCount } from '$lib/format';
	import type { CommentThread, CommentNode } from '$lib/server/db/schema';

	interface Props {
		comments: CommentThread[];
		totalCount?: number | null;
	}
	let { comments, totalCount = null }: Props = $props();

	// Collapse the whole section, and reveal each thread's replies on demand —
	// keeps the initial DOM small (top-level comments only) so the page stays snappy.
	let open = $state(true);
	let expanded = $state<Set<number>>(new Set());

	function toggleReplies(i: number) {
		const next = new Set(expanded);
		if (next.has(i)) next.delete(i);
		else next.add(i);
		expanded = next;
	}

	function initial(name: string): string {
		return (name.replace(/^@/, '')[0] ?? '?').toUpperCase();
	}
</script>

{#if comments.length}
	<section class="card mt-4 p-4">
		<button
			type="button"
			class="flex w-full items-center gap-2 text-left"
			onclick={() => (open = !open)}
			aria-expanded={open}
		>
			<span class="text-sm font-semibold">Comments{totalCount ? ` · ${formatCount(totalCount)}` : ''}</span>
			<span class="ml-auto text-xs text-fg-faint">{open ? 'Hide' : 'Show'}</span>
			<span class="text-xs text-fg-faint transition-transform {open ? 'rotate-90' : ''}">▸</span>
		</button>

		{#if open}
			<p class="mb-4 mt-2 text-xs text-fg-faint">Top comments, captured at download time.</p>
			<ul class="flex flex-col gap-4">
				{#each comments as c, i (i)}
					<li class="[contain-intrinsic-size:auto_64px] [content-visibility:auto]">
						{@render comment(c)}
						{#if c.replies.length}
							{#if expanded.has(i)}
								<ul class="mt-3 flex flex-col gap-3 border-l border-line pl-4">
									{#each c.replies as r, j (j)}<li>{@render comment(r)}</li>{/each}
								</ul>
							{/if}
							<button
								type="button"
								class="mt-2 text-xs font-medium text-accent hover:underline"
								onclick={() => toggleReplies(i)}
							>
								{expanded.has(i)
									? 'Hide replies'
									: `View ${c.replies.length} repl${c.replies.length === 1 ? 'y' : 'ies'}`}
							</button>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
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
