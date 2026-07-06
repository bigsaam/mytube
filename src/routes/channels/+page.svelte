<script lang="ts">
	import PageHeader from '$lib/components/PageHeader.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import { enhance } from '$app/forms';
	import { formatRelative } from '$lib/format';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
	let adding = $state(false);
	let importing = $state(false);
</script>

<PageHeader title="Channels" subtitle="Subscriptions polled via public RSS — no API key" />

<div class="mb-6 grid gap-4 lg:grid-cols-2">
	<!-- Add channel -->
	<div class="card p-4">
		<h2 class="mb-3 text-sm font-medium">Add a channel</h2>
		<form
			method="POST"
			action="?/add"
			use:enhance={() => {
				adding = true;
				return async ({ update }) => {
					await update({ reset: true });
					adding = false;
				};
			}}
			class="flex gap-2"
		>
			<input class="input flex-1" name="input" placeholder="Channel URL, @handle, or any video link" />
			<button class="btn-primary" type="submit" disabled={adding}>{adding ? 'Resolving…' : 'Add'}</button>
		</form>
		<p class="mt-2 text-xs text-fg-faint">
			Paste anything: <code>youtube.com/@channel</code>, a <code>/channel/UC…</code> URL, or a video link.
		</p>
	</div>

	<!-- Import Takeout -->
	<div class="card p-4">
		<h2 class="mb-3 text-sm font-medium">Import subscriptions</h2>
		<form
			method="POST"
			action="?/importCsv"
			enctype="multipart/form-data"
			use:enhance={() => {
				importing = true;
				return async ({ update }) => {
					await update({ reset: true });
					importing = false;
				};
			}}
			class="flex gap-2"
		>
			<input class="input flex-1 file:mr-3 file:rounded file:border-0 file:bg-bg-raised file:px-3 file:py-1 file:text-fg" type="file" name="csv" accept=".csv" />
			<button class="btn-ghost" type="submit" disabled={importing}>{importing ? 'Importing…' : 'Import'}</button>
		</form>
		<p class="mt-2 text-xs text-fg-faint">Google Takeout → YouTube → <code>subscriptions.csv</code>.</p>
	</div>
</div>

{#if form?.error}
	<p class="mb-4 rounded-md bg-red-950 px-3 py-2 text-sm text-red-300">{form.error}</p>
{:else if form?.added}
	<p class="mb-4 rounded-md bg-accent-soft px-3 py-2 text-sm text-accent">Added {form.name}.</p>
{:else if form?.exists}
	<p class="mb-4 rounded-md bg-bg-raised px-3 py-2 text-sm text-fg-muted">Already following that channel.</p>
{:else if form?.imported != null}
	<p class="mb-4 rounded-md bg-accent-soft px-3 py-2 text-sm text-accent">Imported {form.imported} new channel(s) of {form.total}.</p>
{/if}

{#if data.channels.length === 0}
	<EmptyState icon="channels" title="No channels yet" hint="Add one above to start seeing new uploads in your Feed." />
{:else}
	<div class="flex flex-col divide-y divide-line rounded-xl border border-line">
		{#each data.channels as c (c.id)}
			<div class="flex items-center gap-4 p-4">
				<div class="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-bg-raised text-fg-muted">
					<Icon name="channels" size={20} />
				</div>
				<div class="min-w-0 flex-1">
					<a href={c.url} target="_blank" rel="noreferrer" class="truncate font-medium hover:text-white">{c.name}</a>
					<p class="text-xs text-fg-faint">
						{c.videoCount} in library · {c.lastPolledAt ? `polled ${formatRelative(c.lastPolledAt)}` : 'not polled yet'}
					</p>
				</div>

				<!-- Auto-grab toggle -->
				<form method="POST" action="?/toggleAutoGrab" use:enhance>
					<input type="hidden" name="id" value={c.id} />
					<input type="hidden" name="on" value={c.autoGrab ? '0' : '1'} />
					<button class="chip {c.autoGrab ? 'text-accent' : 'text-fg-faint'}" type="submit" title="Auto-grab every new upload">
						<Icon name="grab" size={14} /> Auto-grab {c.autoGrab ? 'on' : 'off'}
					</button>
				</form>

				<form method="POST" action="?/pollNow" use:enhance>
					<input type="hidden" name="id" value={c.id} />
					<button class="btn-ghost px-2 py-1.5" type="submit" title="Poll now"><Icon name="retry" size={16} /></button>
				</form>

				<form method="POST" action="?/remove" use:enhance>
					<input type="hidden" name="id" value={c.id} />
					<button class="btn-ghost px-2 py-1.5 text-red-400/80 hover:text-red-400" type="submit" title="Unfollow"><Icon name="trash" size={16} /></button>
				</form>
			</div>
		{/each}
	</div>
{/if}
