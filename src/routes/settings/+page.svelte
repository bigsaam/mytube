<script lang="ts">
	import PageHeader from '$lib/components/PageHeader.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import { formatBytes, formatRelative, formatUntil } from '$lib/format';
	import { enhance } from '$app/forms';
	import { page } from '$app/stores';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
	let s = $derived(data.settings);
	let updatingYtdlp = $state(false);

	const HEIGHTS = [360, 480, 720, 1080, 1440, 2160];
	const POLICIES = [
		{ v: 'keep_forever', label: 'Keep forever' },
		{ v: 'delete_after_days', label: 'Delete watched after N days' },
		{ v: 'delete_immediately', label: 'Delete immediately when watched' }
	];

	let origin = $derived($page.url.origin);
	// When auth is on, cross-site bookmarklet requests can't use the cookie, so a
	// device token must be embedded via ?token=. Left as a placeholder to fill in.
	let tokenSuffix = $derived(data.authEnabled ? `+'&token=YOUR_TOKEN'` : '');
	let bookmarklet = $derived(
		`javascript:(()=>{fetch('${origin}/api/add?url='+encodeURIComponent(location.href)${tokenSuffix}).then(r=>r.json()).then(d=>alert(d.message||('Queued '+(d.queued||0)))).catch(e=>alert('MyTube: '+e))})();`
	);

	let maxChannelBytes = $derived(Math.max(1, ...data.storage.perChannel.map((c) => c.bytes)));
</script>

<PageHeader title="Settings" subtitle="Quality, cleanup, feeds, and integrations" />

{#if form?.saved}<p class="mb-4 rounded-md bg-accent-soft px-3 py-2 text-sm text-accent">Settings saved.</p>{/if}
{#if form?.cleaned != null}<p class="mb-4 rounded-md bg-accent-soft px-3 py-2 text-sm text-accent">Cleaned up {form.cleaned} watched video(s).</p>{/if}
{#if form?.ytdlpUpdated}<p class="mb-4 rounded-md bg-accent-soft px-3 py-2 text-sm text-accent">yt-dlp updated to {form.version}.</p>{/if}
{#if form?.error}<p class="mb-4 rounded-md bg-red-950 px-3 py-2 text-sm text-red-300">{form.error}</p>{/if}

{#if (data.flags.recommendedFeedEnabled || data.flags.historySyncEnabled) && s.recommendedStatus === 'needs_attention'}
	<a href="/settings/recommended" class="mb-4 flex items-center gap-3 rounded-lg bg-amber-950 px-4 py-3 text-sm text-amber-300 hover:bg-amber-900">
		<Icon name="warning" size={18} />
		<span>Recommended feed needs attention{#if s.recommendedMessage} — {s.recommendedMessage}{/if}. Click to fix →</span>
	</a>
{/if}

<div class="grid gap-6 lg:grid-cols-3">
	<!-- Storage dashboard -->
	<section class="card p-5 lg:col-span-1">
		<h2 class="mb-4 text-sm font-semibold uppercase tracking-wide text-fg-muted">Storage</h2>
		<div class="mb-4">
			<div class="text-3xl font-semibold">{formatBytes(data.storage.totalBytes)}</div>
			<div class="text-sm text-fg-muted">{data.storage.videoCount} videos on disk</div>
		</div>

		<div class="mb-4 rounded-lg bg-bg p-3">
			<div class="flex items-center justify-between text-sm">
				<span class="text-fg-muted">Reclaimable (watched, unpinned)</span>
				<span class="font-medium">{formatBytes(data.storage.watchedReclaimableBytes)}</span>
			</div>
			<form method="POST" action="?/cleanupNow" use:enhance class="mt-2">
				<button class="btn-ghost w-full text-sm" type="submit" disabled={data.storage.watchedReclaimableCount === 0}>
					<Icon name="trash" size={15} /> Clean up {data.storage.watchedReclaimableCount} watched now
				</button>
			</form>
		</div>

		{#if data.storage.perChannel.length}
			<h3 class="mb-2 text-xs font-medium text-fg-muted">By channel</h3>
			<ul class="flex flex-col gap-2">
				{#each data.storage.perChannel.slice(0, 8) as c (c.channelId ?? c.channelName)}
					<li>
						<div class="flex justify-between text-xs">
							<span class="truncate text-fg">{c.channelName ?? 'Unknown'}</span>
							<span class="tabular-nums text-fg-muted">{formatBytes(c.bytes)}</span>
						</div>
						<div class="mt-1 h-1.5 rounded-full bg-bg-raised">
							<div class="h-full rounded-full bg-accent/70" style="width:{(c.bytes / maxChannelBytes) * 100}%"></div>
						</div>
					</li>
				{/each}
			</ul>
		{/if}
	</section>

	<!-- Main settings form -->
	<form method="POST" action="?/save" use:enhance class="lg:col-span-2">
		<div class="flex flex-col gap-6">
			<!-- Downloads -->
			<section class="card p-5">
				<h2 class="mb-4 text-sm font-semibold uppercase tracking-wide text-fg-muted">Downloads</h2>
				<label class="mb-3 flex items-center justify-between gap-4">
					<span class="text-sm">Max resolution</span>
					<select name="defaultMaxHeight" class="input w-40">
						{#each HEIGHTS as h (h)}<option value={h} selected={s.defaultMaxHeight === h}>{h}p</option>{/each}
					</select>
				</label>
				<label class="mb-3 flex items-center gap-3 text-sm">
					<input type="checkbox" name="preferH264" checked={s.preferH264} class="accent-accent" />
					Prefer H.264/AAC (best browser compatibility, no transcoding)
				</label>
				<label class="flex items-center gap-3 text-sm">
					<input type="checkbox" name="fetchComments" checked={s.fetchComments} class="accent-accent" />
					Fetch top comments (20 threads, 5 replies each) — adds time to each download
				</label>
			</section>

			<!-- Watched & cleanup -->
			<section class="card p-5">
				<h2 class="mb-4 text-sm font-semibold uppercase tracking-wide text-fg-muted">Watched &amp; cleanup</h2>
				<label class="mb-3 flex items-center justify-between gap-4">
					<span class="text-sm">Auto-mark watched at</span>
					<span class="flex items-center gap-2">
						<input type="number" name="autoMarkWatchedPercent" min="50" max="100" value={s.autoMarkWatchedPercent} class="input w-20" />
						<span class="text-sm text-fg-muted">%</span>
					</span>
				</label>
				<label class="mb-3 flex items-center justify-between gap-4">
					<span class="text-sm">Cleanup policy</span>
					<select name="cleanupPolicy" class="input w-64">
						{#each POLICIES as p (p.v)}<option value={p.v} selected={s.cleanupPolicy === p.v}>{p.label}</option>{/each}
					</select>
				</label>
				<label class="mb-3 flex items-center justify-between gap-4">
					<span class="text-sm">Keep watched for (days)</span>
					<input type="number" name="cleanupKeepDays" min="1" value={s.cleanupKeepDays} class="input w-20" />
				</label>
				<label class="mb-2 flex items-center gap-3 text-sm">
					<input type="checkbox" name="cleanupPlaylistWatched" checked={s.cleanupPlaylistWatched} class="accent-accent" />
					Auto-clean watched videos from the synced playlist (queue mode)
				</label>
				<label class="flex items-center gap-3 text-sm">
					<input type="checkbox" name="playlistRemoveOnDownload" checked={s.playlistRemoveOnDownload} class="accent-accent" />
					Remove from the YouTube playlist once downloaded (vs. once watched)
				</label>
				<p class="mt-2 text-xs text-fg-faint">Kept videos (the "Keep" toggle) are always exempt. Deleting files keeps the history record; the video can be re-grabbed.</p>
			</section>

			<!-- SponsorBlock -->
			<section class="card p-5">
				<h2 class="mb-4 text-sm font-semibold uppercase tracking-wide text-fg-muted">SponsorBlock</h2>
				<label class="mb-2 flex items-center gap-3 text-sm">
					<input type="checkbox" name="sponsorblockEnabled" checked={s.sponsorblockEnabled} class="accent-accent" /> Fetch segments on download
				</label>
				<label class="mb-3 flex items-center justify-between gap-4 text-sm">
					<span>When downloading</span>
					<select name="sponsorblockMode" class="input w-56">
						<option value="remove" selected={s.sponsorblockMode === 'remove'}>Cut segments from the file</option>
						<option value="skip" selected={s.sponsorblockMode === 'skip'}>Keep file, skip in player</option>
					</select>
				</label>
				<label class="mb-3 flex items-center gap-3 text-sm">
					<input type="checkbox" name="sponsorblockAutoSkip" checked={s.sponsorblockAutoSkip} class="accent-accent" /> Auto-skip by default in the player (skip mode)
				</label>
				<div class="flex flex-wrap gap-x-4 gap-y-2">
					{#each data.sbCategories as cat (cat)}
						<label class="flex items-center gap-2 text-xs capitalize">
							<input type="checkbox" name={`sb_${cat}`} checked={s.sponsorblockCategories.includes(cat)} class="accent-accent" />
							{cat.replace('_', ' ')}
						</label>
					{/each}
				</div>
			</section>

			<!-- Feed -->
			<section class="card p-5">
				<h2 class="mb-4 text-sm font-semibold uppercase tracking-wide text-fg-muted">Feed &amp; scheduler</h2>
				<label class="mb-3 flex items-center justify-between gap-4">
					<span class="text-sm">RSS poll interval (minutes)</span>
					<input type="number" name="rssPollIntervalMin" min="5" value={s.rssPollIntervalMin} class="input w-24" />
				</label>
				<label class="flex items-center justify-between gap-4">
					<span class="text-sm">Feed items expire after (days, 0 = never)</span>
					<input type="number" name="feedItemExpiryDays" min="0" value={s.feedItemExpiryDays} class="input w-24" />
				</label>
			</section>

			<div class="flex justify-end">
				<button class="btn-primary" type="submit">Save settings</button>
			</div>
		</div>
	</form>
</div>

<!-- YouTube playlist sync -->
<div class="mt-6">
	<a href="/settings/youtube" class="card flex items-center gap-4 p-5 hover:bg-bg-hover">
		<div class="grid h-10 w-10 place-items-center rounded-full bg-bg-raised text-fg-muted">
			<Icon name="watch-later" size={20} />
		</div>
		<div class="flex-1">
			<h2 class="text-sm font-semibold">YouTube playlist sync</h2>
			<p class="text-xs text-fg-muted">
				Add videos to a playlist on your phone → auto-download → auto-remove when watched.
				{#if data.youtube.connected}<span class="text-accent"> · Connected</span>{:else}<span class="text-fg-faint"> · Not connected</span>{/if}
			</p>
		</div>
		<span class="text-fg-faint">→</span>
	</a>
</div>

<!-- Access & API tokens -->
{#if data.authEnabled}
	<section class="card mt-6 p-5">
		<h2 class="mb-1 text-sm font-semibold uppercase tracking-wide text-fg-muted">Access &amp; API tokens</h2>
		<p class="mb-4 text-xs text-fg-faint">
			Issue a revocable bearer token per device (native app, iOS Shortcut, bookmarklet). Send it as
			<code>Authorization: Bearer &lt;token&gt;</code>. Revoke any time without affecting others.
		</p>

		{#if form?.newToken}
			<div class="mb-4 rounded-lg border border-accent/40 bg-accent-soft p-3">
				<p class="mb-1 text-xs text-accent">New token for “{form.newTokenName}” — copy it now, it won't be shown again:</p>
				<code class="block break-all rounded bg-bg p-2 text-xs text-fg">{form.newToken}</code>
			</div>
		{/if}

		<form method="POST" action="?/createToken" use:enhance class="mb-4 flex gap-2">
			<input class="input flex-1" name="name" placeholder="Token name (e.g. iPhone, Shortcuts)" />
			<button class="btn-primary" type="submit">Create token</button>
		</form>

		{#if data.apiTokens.length}
			<ul class="divide-y divide-line rounded-lg border border-line">
				{#each data.apiTokens as t (t.id)}
					<li class="flex items-center gap-3 p-3 text-sm {t.revoked ? 'opacity-50' : ''}">
						<code class="text-fg-muted">{t.tokenPrefix}…</code>
						<span class="font-medium">{t.name}</span>
						<span class="text-xs text-fg-faint">
							{t.lastUsedAt ? `used ${formatRelative(t.lastUsedAt)}` : 'never used'}
						</span>
						<div class="ml-auto">
							{#if t.revoked}
								<span class="chip text-fg-faint">revoked</span>
							{:else}
								<form method="POST" action="?/revokeToken" use:enhance>
									<input type="hidden" name="id" value={t.id} />
									<button class="btn-ghost px-2 py-1 text-xs text-red-400/80" type="submit">Revoke</button>
								</form>
							{/if}
						</div>
					</li>
				{/each}
			</ul>
		{/if}
	</section>
{:else}
	<section class="card mt-6 border border-amber-900/40 p-5">
		<h2 class="mb-1 text-sm font-semibold uppercase tracking-wide text-amber-400/90">Access &amp; API tokens</h2>
		<p class="text-sm text-fg-muted">
			Auth is currently <strong>off</strong> (LAN-only mode). Set <code>AUTH_TOKEN</code> or
			<code>AUTH_PASSWORD</code> in your environment to enable login + issue API tokens before exposing MyTube publicly.
		</p>
	</section>
{/if}

<!-- Shared links -->
<section class="card mt-6 p-5">
	<h2 class="mb-1 text-sm font-semibold uppercase tracking-wide text-fg-muted">Shared links</h2>
	<p class="mb-4 text-xs text-fg-faint">
		Per-video public links (created from a video's <strong>Share</strong> button). Each grants access to that one
		video only. Revoke here to kill a link immediately.
	</p>
	{#if data.shares.length}
		<ul class="divide-y divide-line rounded-lg border border-line">
			{#each data.shares as s (s.id)}
				<li class="flex items-center gap-3 p-3 text-sm {s.revoked ? 'opacity-50' : ''}">
					<code class="shrink-0 text-fg-muted">{s.tokenPrefix}…</code>
					<a href="/watch/{s.videoId}" class="min-w-0 flex-1 truncate font-medium hover:text-white">
						{s.label ? `${s.label} — ` : ''}{s.videoTitle ?? s.videoId}
					</a>
					<span class="shrink-0 text-xs text-fg-faint">
						{s.revoked ? 'revoked' : s.expiresAt ? `expires ${formatUntil(s.expiresAt)}` : 'never expires'} ·
						{s.viewCount} view{s.viewCount === 1 ? '' : 's'}
					</span>
					<div class="ml-auto shrink-0">
						{#if s.revoked}
							<span class="chip text-fg-faint">revoked</span>
						{:else}
							<form method="POST" action="?/revokeShare" use:enhance>
								<input type="hidden" name="id" value={s.id} />
								<button class="btn-ghost px-2 py-1 text-xs text-red-400/80" type="submit">Revoke</button>
							</form>
						{/if}
					</div>
				</li>
			{/each}
		</ul>
	{:else}
		<p class="text-sm text-fg-faint">No shared links yet. Open any video and click <strong>Share</strong> to create one.</p>
	{/if}
</section>

<!-- Maintenance -->
<div class="mt-6 grid gap-6 lg:grid-cols-2">
	<section class="card p-5">
		<h2 class="mb-3 text-sm font-semibold uppercase tracking-wide text-fg-muted">yt-dlp</h2>
		<p class="mb-3 text-sm text-fg-muted">
			Version: <span class="font-mono text-fg">{data.ytdlpVersion ?? 'not found'}</span>
		</p>
		<p class="mb-3 text-xs text-fg-faint">Extractor breakage is the #1 failure mode — update when downloads start failing.</p>
		<form method="POST" action="?/updateYtdlp" use:enhance={() => { updatingYtdlp = true; return async ({ update }) => { await update(); updatingYtdlp = false; }; }}>
			<button class="btn-ghost" type="submit" disabled={updatingYtdlp}>
				<Icon name="retry" size={15} /> {updatingYtdlp ? 'Updating…' : 'Update yt-dlp (yt-dlp -U)'}
			</button>
		</form>
	</section>

	<section class="card p-5">
		<h2 class="mb-3 text-sm font-semibold uppercase tracking-wide text-fg-muted">Bookmarklet</h2>
		<p class="mb-3 text-xs text-fg-faint">Drag this to your bookmarks bar, then click it on any YouTube page to grab the video.</p>
		<a href={bookmarklet} class="btn-accent" onclick={(e) => e.preventDefault()}>▶ Grab to MyTube</a>
		<textarea readonly class="input mt-3 h-24 w-full font-mono text-[11px]" onclick={(e) => e.currentTarget.select()}>{bookmarklet}</textarea>
	</section>

	{#if data.flags.recommendedFeedEnabled || data.flags.historySyncEnabled}
		<section class="card p-5 lg:col-span-2">
			<h2 class="mb-3 text-sm font-semibold uppercase tracking-wide text-fg-muted">Recommended feed &amp; history sync</h2>
			<p class="text-sm text-fg-muted">These integrations are configured on the dedicated page.</p>
			<a href="/settings/recommended" class="btn-ghost mt-3">Open recommended-feed settings →</a>
		</section>
	{/if}
</div>
