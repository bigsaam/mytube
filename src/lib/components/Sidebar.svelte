<script lang="ts">
	import { page } from '$app/stores';
	import Icon from './Icon.svelte';

	const nav = [
		{ href: '/feed', label: 'Feed', icon: 'feed' },
		{ href: '/watch-later', label: 'Watch Later', icon: 'watch-later' },
		{ href: '/library', label: 'Library', icon: 'library' },
		{ href: '/channels', label: 'Channels', icon: 'channels' },
		{ href: '/downloads', label: 'Downloads', icon: 'downloads' },
		{ href: '/settings', label: 'Settings', icon: 'settings' }
	];

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
		<span class="text-lg font-semibold tracking-tight">Haystack</span>
	</a>

	<nav class="flex flex-col gap-1">
		{#each nav as item (item.href)}
			<a
				href={item.href}
				class="flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors
					{active(item.href) ? 'bg-bg-raised font-medium text-fg' : 'text-fg-muted hover:bg-bg-soft hover:text-fg'}"
			>
				<Icon name={item.icon} size={18} />
				{item.label}
			</a>
		{/each}
	</nav>

	<div class="mt-auto px-3 pt-4 text-xs text-fg-faint">
		<p>Self-hosted · LAN only</p>
	</div>
</aside>
