<script lang="ts">
	import Icon from './Icon.svelte';
	interface Props {
		icon?: string;
		title: string;
		hint?: string;
	}
	let { icon = 'library', title, hint }: Props = $props();
</script>

<div class="grid place-items-center rounded-xl border border-dashed border-line py-20 text-center">
	<div class="mb-3 grid h-12 w-12 place-items-center rounded-full bg-bg-raised text-fg-faint">
		<Icon name={icon} size={24} />
	</div>
	<p class="text-fg-muted">{title}</p>
	{#if hint}<p class="mt-1 max-w-sm text-sm text-fg-faint">{hint}</p>{/if}
</div>
