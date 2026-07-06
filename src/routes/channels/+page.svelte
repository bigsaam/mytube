<script lang="ts">
	import PageHeader from '$lib/components/PageHeader.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
</script>

<PageHeader title="Channels" subtitle="Subscriptions polled via public RSS" />
<EmptyState icon="channels" title="No channels yet" hint="Paste a channel URL or handle, or import a Google Takeout subscriptions.csv." />
