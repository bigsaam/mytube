<script lang="ts">
	import Icon from './Icon.svelte';
	import { invalidateAll } from '$app/navigation';

	let url = $state('');
	let busy = $state(false);
	let message = $state<{ kind: 'ok' | 'err'; text: string } | null>(null);
	// Pending playlist confirmation.
	let playlist = $state<{ ids: string[]; count: number } | null>(null);

	async function post(body: Record<string, unknown>) {
		const res = await fetch('/api/add', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body)
		});
		const data = await res.json().catch(() => ({}));
		if (!res.ok) throw new Error(data?.message ?? 'Failed to add');
		return data;
	}

	function flash(kind: 'ok' | 'err', text: string) {
		message = { kind, text };
		setTimeout(() => (message = null), 4000);
	}

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		const value = url.trim();
		if (!value || busy) return;
		busy = true;
		message = null;
		try {
			const data = await post({ url: value });
			if (data.requiresConfirmation) {
				playlist = { ids: data.entries.map((x: { videoId: string }) => x.videoId), count: data.count };
			} else {
				url = '';
				flash('ok', data.message ?? 'Queued');
				await invalidateAll();
			}
		} catch (err) {
			flash('err', err instanceof Error ? err.message : 'Failed');
		} finally {
			busy = false;
		}
	}

	async function confirmPlaylist(watchLater: boolean) {
		if (!playlist || busy) return;
		busy = true;
		try {
			const data = await post({ videoIds: playlist.ids, addToWatchLater: watchLater });
			playlist = null;
			url = '';
			flash('ok', data.message ?? 'Queued');
			await invalidateAll();
		} catch (err) {
			flash('err', err instanceof Error ? err.message : 'Failed');
		} finally {
			busy = false;
		}
	}
</script>

<div class="relative w-full max-w-xl">
	<form onsubmit={submit} class="flex items-center gap-2">
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
	</form>

	{#if playlist}
		<div class="absolute left-0 top-12 z-20 w-full rounded-lg border border-line bg-bg-soft p-4 shadow-xl">
			<p class="text-sm">This is a playlist with <strong>{playlist.count}</strong> videos. Download all?</p>
			<div class="mt-3 flex gap-2">
				<button class="btn-accent" onclick={() => confirmPlaylist(false)} disabled={busy}>
					Grab all {playlist.count}
				</button>
				<button class="btn-ghost" onclick={() => confirmPlaylist(true)} disabled={busy}>
					Grab + Watch Later
				</button>
				<button class="btn-ghost" onclick={() => (playlist = null)} disabled={busy}>Cancel</button>
			</div>
		</div>
	{/if}

	{#if message}
		<div
			class="absolute -bottom-9 left-0 rounded-md px-3 py-1.5 text-xs
				{message.kind === 'ok' ? 'bg-accent-soft text-accent' : 'bg-red-950 text-red-300'}"
			role="status"
		>
			{message.text}
		</div>
	{/if}
</div>
