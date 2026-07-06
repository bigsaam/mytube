<script lang="ts">
	import PageHeader from '$lib/components/PageHeader.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
</script>

<PageHeader title="Downloads" subtitle="Queued, active, and failed jobs" />
<EmptyState icon="downloads" title="No downloads" hint="Grab a video to see live progress here." />
