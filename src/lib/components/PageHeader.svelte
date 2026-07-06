<script lang="ts">
	interface Props {
		title: string;
		subtitle?: string;
		children?: import('svelte').Snippet;
	}
	let { title, subtitle, children }: Props = $props();
</script>

<div class="mb-6 flex items-end justify-between gap-4">
	<div>
		<h1 class="text-2xl font-semibold tracking-tight">{title}</h1>
		{#if subtitle}<p class="mt-1 text-sm text-fg-muted">{subtitle}</p>{/if}
	</div>
	{#if children}<div class="flex items-center gap-2">{@render children()}</div>{/if}
</div>
