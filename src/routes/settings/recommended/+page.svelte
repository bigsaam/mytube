<script lang="ts">
	import PageHeader from '$lib/components/PageHeader.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import { enhance } from '$app/forms';
	import { formatRelative } from '$lib/format';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
	let s = $derived(data.settings);
	let statusColor = $derived(
		s.recommendedStatus === 'needs_attention'
			? 'bg-amber-950 text-amber-300'
			: s.recommendedStatus === 'ok'
				? 'bg-accent-soft text-accent'
				: 'bg-bg-raised text-fg-muted'
	);
</script>

<PageHeader title="Recommended feed & history sync" subtitle="Optional, cookie-authenticated integrations">
	<a href="/settings" class="btn-ghost text-sm">← Settings</a>
</PageHeader>

{#if form?.error}<p class="mb-4 rounded-md bg-red-950 px-3 py-2 text-sm text-red-300">{form.error}</p>{/if}
{#if form?.cookiesSaved}<p class="mb-4 rounded-md bg-accent-soft px-3 py-2 text-sm text-accent">Cookies saved.</p>{/if}
{#if form?.saved}<p class="mb-4 rounded-md bg-accent-soft px-3 py-2 text-sm text-accent">Saved.</p>{/if}
{#if form?.scraping}<p class="mb-4 rounded-md bg-accent-soft px-3 py-2 text-sm text-accent">Scrape queued — check <a href="/discover" class="underline">Discover</a> shortly.</p>{/if}

<!-- Status banner -->
<div class="mb-6 flex items-center gap-3 rounded-lg px-4 py-3 {statusColor}">
	<Icon name={s.recommendedStatus === 'needs_attention' ? 'warning' : 'feed'} size={18} />
	<div class="text-sm">
		<span class="font-medium capitalize">{s.recommendedStatus.replace('_', ' ')}</span>
		{#if s.recommendedMessage}<span> — {s.recommendedMessage}</span>{/if}
	</div>
</div>

<div class="grid gap-6 lg:grid-cols-2">
	<!-- Cookies -->
	<section class="card p-5">
		<h2 class="mb-2 text-sm font-semibold uppercase tracking-wide text-fg-muted">YouTube cookies</h2>
		<p class="mb-3 text-xs text-fg-faint">
			Export with the “Get cookies.txt LOCALLY” browser extension while logged into YouTube. Used to
			seed a persistent browser session and (optionally) passed to yt-dlp for members/age-gated videos.
		</p>
		<p class="mb-3 text-sm">
			Status:
			{#if data.cookiesPresent}
				<span class="text-accent">uploaded{#if s.cookiesUploadedAt} · {formatRelative(s.cookiesUploadedAt)}{/if}</span>
			{:else}
				<span class="text-fg-faint">none</span>
			{/if}
		</p>
		<form method="POST" action="?/uploadCookies" enctype="multipart/form-data" use:enhance class="flex gap-2">
			<input class="input flex-1" type="file" name="cookies" accept=".txt" />
			<button class="btn-primary" type="submit">Upload</button>
		</form>
		{#if data.cookiesPresent}
			<form method="POST" action="?/removeCookies" use:enhance class="mt-2">
				<button class="btn-ghost text-xs text-red-400/80" type="submit">Remove cookies</button>
			</form>
		{/if}
	</section>

	<!-- Recommended filters -->
	{#if data.flags.recommendedFeedEnabled}
		<section class="card p-5">
			<h2 class="mb-3 text-sm font-semibold uppercase tracking-wide text-fg-muted">Recommended feed</h2>
			<form method="POST" action="?/saveRecommended" use:enhance>
				<div class="flex flex-col gap-2 text-sm">
					<label class="flex items-center gap-3"><input type="checkbox" name="filterShorts" checked={s.recommendedFilterShorts} class="accent-accent" /> Filter out Shorts</label>
					<label class="flex items-center gap-3"><input type="checkbox" name="filterLive" checked={s.recommendedFilterLive} class="accent-accent" /> Filter out live / upcoming</label>
					<label class="flex items-center gap-3"><input type="checkbox" name="filterMixes" checked={s.recommendedFilterMixes} class="accent-accent" /> Filter out mixes / playlists</label>
					<label class="mt-2 flex items-center justify-between gap-4">
						<span>Scrapes per day</span>
						<input type="number" name="pollsPerDay" min="2" max="4" value={s.recommendedPollsPerDay} class="input w-20" />
					</label>
				</div>
				<div class="mt-4 flex gap-2">
					<button class="btn-primary" type="submit">Save</button>
				</div>
			</form>
			<form method="POST" action="?/scrapeNow" use:enhance class="mt-2">
				<button class="btn-ghost" type="submit" disabled={!data.cookiesPresent}>
					<Icon name="retry" size={15} /> Scrape now
				</button>
			</form>
		</section>
	{/if}

	{#if data.flags.historySyncEnabled}
		<section class="card p-5 lg:col-span-2">
			<h2 class="mb-2 text-sm font-semibold uppercase tracking-wide text-fg-muted">History sync</h2>
			<p class="text-xs text-fg-faint">
				When you mark a video watched, MyTube tells YouTube it was watched (jittered {s.historySyncMinDelayMin}–{s.historySyncMaxDelayMin} min later) so your
				recommendations keep learning. Requires cookies. Per-video opt-out lives in the player menu.
			</p>
		</section>
	{/if}
</div>
