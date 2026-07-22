<script lang="ts">
	import '../app.css';
	import { page } from '$app/stores';
	import Sidebar from '$lib/components/Sidebar.svelte';
	import QuickAdd from '$lib/components/QuickAdd.svelte';
	import Footer from '$lib/components/Footer.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import type { LayoutData } from './$types';

	let { children, data }: { children: import('svelte').Snippet; data: LayoutData } = $props();

	// The login page and public share pages render without the app chrome.
	let bare = $derived($page.url.pathname === '/login' || $page.url.pathname.startsWith('/s/'));

	// Mobile off-canvas nav drawer. Static sidebar at md+; overlay below.
	let navOpen = $state(false);
	function closeNav() {
		navOpen = false;
	}
</script>

{#if bare}
	{@render children()}
{:else}
<div class="flex h-screen overflow-hidden">
	<Sidebar counts={data.counts} showLogout={data.authEnabled} open={navOpen} onNavigate={closeNav} />

	<!-- Backdrop for the mobile drawer; only interactive while open. -->
	{#if navOpen}
		<button
			type="button"
			aria-label="Close menu"
			class="fixed inset-0 z-30 bg-black/50 md:hidden"
			onclick={closeNav}
		></button>
	{/if}

	<div class="flex min-w-0 flex-1 flex-col">
		<header
			class="flex h-14 shrink-0 items-center gap-3 border-b border-line bg-bg/80 px-4 backdrop-blur sm:px-6"
		>
			<button
				type="button"
				aria-label="Open menu"
				class="-ml-1 grid h-9 w-9 shrink-0 place-items-center rounded-lg text-fg-muted hover:bg-bg-soft hover:text-fg md:hidden"
				onclick={() => (navOpen = true)}
			>
				<Icon name="menu" size={20} />
			</button>
			<QuickAdd />
		</header>

		<!-- Column layout so the footer sits at the bottom of the viewport on short
		     pages, instead of floating up under the content. -->
		<main class="flex flex-1 flex-col overflow-y-auto px-4 py-5 sm:px-6 sm:py-6">
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
