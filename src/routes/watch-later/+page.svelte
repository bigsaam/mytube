<script lang="ts">
	import PageHeader from '$lib/components/PageHeader.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
</script>

<PageHeader title="Watch Later" subtitle="Your ordered queue" />
<EmptyState icon="watch-later" title="Nothing queued" hint="Grab a video to Watch Later from the feed or the quick-add box." />
