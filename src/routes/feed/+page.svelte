<script lang="ts">
	import PageHeader from '$lib/components/PageHeader.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
</script>

<PageHeader title="Feed" subtitle="New uploads from your channels" />
<EmptyState icon="feed" title="No feed items yet" hint="Add channels to start seeing new uploads here." />
