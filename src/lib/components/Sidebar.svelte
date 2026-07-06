<script lang="ts">
	import { page } from '$app/stores';
	import Icon from './Icon.svelte';

	interface Props {
		counts?: { feed: number; watchLater: number; downloads: number };
	}
	let { counts }: Props = $props();

	let nav = $derived([
		{ href: '/feed', label: 'Feed', icon: 'feed', badge: counts?.feed },
		{ href: '/watch-later', label: 'Watch Later', icon: 'watch-later', badge: counts?.watchLater },
		{ href: '/library', label: 'Library', icon: 'library', badge: 0 },
		{ href: '/channels', label: 'Channels', icon: 'channels', badge: 0 },
		{ href: '/downloads', label: 'Downloads', icon: 'downloads', badge: counts?.downloads },
		{ href: '/settings', label: 'Settings', icon: 'settings', badge: 0 }
	]);

	function active(href: string): boolean {
		const p = $page.url.pathname;
		return p === href || p.startsWith(href + '/');
	}
</script>

<aside class="flex h-full w-56 shrink-0 flex-col border-r border-line bg-bg px-3 py-4">
	<a href="/feed" class="mb-6 flex items-center gap-2 px-2">
		<div class="grid h-8 w-8 place-items-center rounded-lg bg-accent text-bg">
			<Icon name="play" size={18} />
		</div>
		<span class="text-lg font-semibold tracking-tight">MyTube</span>
	</a>

	<nav class="flex flex-col gap-1">
		{#each nav as item (item.href)}
			<a
				href={item.href}
				class="flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors
					{active(item.href) ? 'bg-bg-raised font-medium text-fg' : 'text-fg-muted hover:bg-bg-soft hover:text-fg'}"
			>
				<Icon name={item.icon} size={18} />
				<span class="flex-1">{item.label}</span>
				{#if item.badge && item.badge > 0}
					<span class="rounded-full bg-bg-hover px-1.5 py-0.5 text-xs tabular-nums text-fg-muted">{item.badge}</span>
				{/if}
			</a>
		{/each}
	</nav>

	<div class="mt-auto px-3 pt-4 text-xs text-fg-faint">
		<p>Self-hosted · LAN only</p>
	</div>
</aside>
