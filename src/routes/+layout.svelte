<script lang="ts">
	import '../app.css';
	import { page } from '$app/stores';
	import Sidebar from '$lib/components/Sidebar.svelte';
	import QuickAdd from '$lib/components/QuickAdd.svelte';
	import Footer from '$lib/components/Footer.svelte';
	import type { LayoutData } from './$types';

	let { children, data }: { children: import('svelte').Snippet; data: LayoutData } = $props();

	// The login page and public share pages render without the app chrome.
	let bare = $derived($page.url.pathname === '/login' || $page.url.pathname.startsWith('/s/'));
</script>

{#if bare}
	{@render children()}
{:else}
<div class="flex h-screen overflow-hidden">
	<Sidebar counts={data.counts} showLogout={data.authEnabled} />

	<div class="flex min-w-0 flex-1 flex-col">
		<header
			class="flex h-14 shrink-0 items-center gap-4 border-b border-line bg-bg/80 px-6 backdrop-blur"
		>
			<QuickAdd />
		</header>

		<!-- Column layout so the footer sits at the bottom of the viewport on short
		     pages, instead of floating up under the content. -->
		<main class="flex flex-1 flex-col overflow-y-auto px-6 py-6">
			<div class="flex-1">
				{@render children()}
			</div>
			<div class="mt-10 pt-4">
				<Footer subtle />
			</div>
		</main>
	</div>
</div>
{/if}
