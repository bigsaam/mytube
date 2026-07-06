<script lang="ts">
	import Icon from './Icon.svelte';
	import { invalidateAll } from '$app/navigation';

	let url = $state('');
	let busy = $state(false);
	let message = $state<{ kind: 'ok' | 'err'; text: string } | null>(null);

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		const value = url.trim();
		if (!value || busy) return;
		busy = true;
		message = null;
		try {
			const res = await fetch('/api/add', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ url: value })
			});
			const data = await res.json();
			if (!res.ok) throw new Error(data?.error ?? 'Failed to add');
			url = '';
			message = { kind: 'ok', text: data.message ?? 'Queued' };
			await invalidateAll();
		} catch (err) {
			message = { kind: 'err', text: err instanceof Error ? err.message : 'Failed' };
		} finally {
			busy = false;
			setTimeout(() => (message = null), 4000);
		}
	}
</script>

<form onsubmit={submit} class="relative flex w-full max-w-xl items-center gap-2">
	<div class="relative flex-1">
		<input
			class="input pr-10"
			type="text"
			bind:value={url}
			placeholder="Paste a YouTube URL to grab…"
			aria-label="Quick add video URL"
		/>
		<Icon name="plus" size={16} class="pointer-events-none absolute right-3 top-2.5 text-fg-faint" />
	</div>
	<button class="btn-primary" type="submit" disabled={busy || !url.trim()}>
		{busy ? 'Adding…' : 'Grab'}
	</button>

	{#if message}
		<div
			class="absolute -bottom-9 left-0 rounded-md px-3 py-1.5 text-xs
				{message.kind === 'ok' ? 'bg-accent-soft text-accent' : 'bg-red-950 text-red-300'}"
			role="status"
		>
			{message.text}
		</div>
	{/if}
</form>
