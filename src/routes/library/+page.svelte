<script lang="ts">
	import PageHeader from '$lib/components/PageHeader.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
</script>

<PageHeader title="Library" subtitle="Everything you've downloaded" />
<EmptyState icon="library" title="Your library is empty" hint="Grab a video and it'll appear here once downloaded." />
