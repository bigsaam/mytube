<script lang="ts">
	import '../app.css';
	import Sidebar from '$lib/components/Sidebar.svelte';
	import QuickAdd from '$lib/components/QuickAdd.svelte';

	let { children } = $props();
</script>

<svelte:head>
	<title>Haystack</title>
</svelte:head>

<div class="flex h-screen overflow-hidden">
	<Sidebar />

	<div class="flex min-w-0 flex-1 flex-col">
		<header
			class="flex h-14 shrink-0 items-center gap-4 border-b border-line bg-bg/80 px-6 backdrop-blur"
		>
			<QuickAdd />
		</header>

		<main class="flex-1 overflow-y-auto px-6 py-6">
			{@render children()}
		</main>
	</div>
</div>
