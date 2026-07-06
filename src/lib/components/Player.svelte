<script lang="ts">
	import { onMount } from 'svelte';
	import Icon from './Icon.svelte';
	import { formatDuration } from '$lib/format';
	import type { Chapter, SponsorSegment } from '$lib/server/db/schema';

	interface Props {
		videoId: string;
		durationSeconds?: number | null;
		hasSubtitles?: boolean;
		chapters?: Chapter[];
		sponsorblock?: SponsorSegment[];
		positionSeconds?: number;
		autoSkipDefault?: boolean;
		theater?: boolean;
	}
	let {
		videoId,
		durationSeconds = null,
		hasSubtitles = false,
		chapters = [],
		sponsorblock = [],
		positionSeconds = 0,
		autoSkipDefault = true,
		theater = $bindable(false)
	}: Props = $props();

	// SponsorBlock category → seekbar color.
	const SB_COLORS: Record<string, string> = {
		sponsor: '#00d95f',
		selfpromo: '#ffff00',
		interaction: '#cc00ff',
		intro: '#00ffff',
		outro: '#0202ed',
		preview: '#008fd6',
		music_offtopic: '#ff9900',
		filler: '#7300ff'
	};

	let container: HTMLDivElement | undefined = $state();
	let video: HTMLVideoElement | undefined = $state();

	let paused = $state(true);
	let muted = $state(false);
	let volume = $state(1);
	let currentTime = $state(0);
	let duration = $state(durationSeconds ?? 0);
	let buffered = $state(0);
	let rate = $state(1);
	let subsOn = $state(false);
	let fullscreen = $state(false);
	let autoSkip = $state(autoSkipDefault);
	let controlsVisible = $state(true);
	let scrubbing = $state(false);
	let skipToast = $state<string | null>(null);
	let showSpeed = $state(false);

	const RATES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

	let percent = $derived(duration > 0 ? currentTime / duration : 0);
	let currentChapter = $derived(
		[...chapters].reverse().find((c) => currentTime >= c.startTime)?.title ?? null
	);

	/* ---------------------------------------------------------- lifecycle */
	onMount(() => {
		const onFs = () => (fullscreen = document.fullscreenElement === container);
		document.addEventListener('fullscreenchange', onFs);
		const beacon = () => flushProgress(true);
		document.addEventListener('visibilitychange', () => {
			if (document.hidden) flushProgress();
		});
		window.addEventListener('beforeunload', beacon);
		const ping = setInterval(() => {
			if (!paused) flushProgress();
		}, 5000);
		return () => {
			document.removeEventListener('fullscreenchange', onFs);
			window.removeEventListener('beforeunload', beacon);
			clearInterval(ping);
			flushProgress();
		};
	});

	function onLoaded() {
		if (!video) return;
		duration = video.duration || duration;
		// Resume, but not if we're essentially at the end.
		if (positionSeconds > 5 && (!duration || positionSeconds < duration * 0.95)) {
			video.currentTime = positionSeconds;
		}
		applyTextTrack();
	}

	/* ----------------------------------------------------- progress sync */
	let lastSent = 0;
	function flushProgress(useBeacon = false) {
		if (!video || duration <= 0) return;
		const pos = video.currentTime;
		if (Math.abs(pos - lastSent) < 1 && !useBeacon) return;
		lastSent = pos;
		const body = JSON.stringify({ videoId, position: pos, duration });
		if (useBeacon && navigator.sendBeacon) {
			navigator.sendBeacon('/api/progress', new Blob([body], { type: 'application/json' }));
		} else {
			fetch('/api/progress', { method: 'POST', headers: { 'content-type': 'application/json' }, body, keepalive: true }).catch(() => {});
		}
	}

	/* ------------------------------------------------- sponsorblock skip */
	function onTimeUpdate() {
		if (!video) return;
		currentTime = video.currentTime;
		if (video.buffered.length) buffered = video.buffered.end(video.buffered.length - 1);
		if (autoSkip) {
			const seg = sponsorblock.find((s) => currentTime >= s.start && currentTime < s.end - 0.3);
			if (seg && seg.end < duration - 0.5) {
				video.currentTime = seg.end;
				toast(`Skipped ${seg.category.replace('_', ' ')}`);
			}
		}
	}

	function toast(msg: string) {
		skipToast = msg;
		setTimeout(() => (skipToast = null), 1500);
	}

	/* ------------------------------------------------------- transport */
	function togglePlay() {
		if (!video) return;
		if (video.paused) video.play();
		else video.pause();
	}
	function seek(to: number) {
		if (!video) return;
		video.currentTime = Math.max(0, Math.min(duration || video.duration, to));
		currentTime = video.currentTime;
	}
	function seekBy(delta: number) {
		seek((video?.currentTime ?? 0) + delta);
	}
	// Exposed to the parent (e.g. clickable description timestamps).
	export function seekTo(t: number) {
		seek(t);
		video?.play();
	}
	function setRate(r: number) {
		rate = r;
		if (video) video.playbackRate = r;
		showSpeed = false;
	}
	function toggleMute() {
		if (!video) return;
		video.muted = !video.muted;
		muted = video.muted;
	}
	function toggleFullscreen() {
		if (!container) return;
		if (document.fullscreenElement) document.exitFullscreen();
		else container.requestFullscreen?.();
	}
	function toggleSubs() {
		subsOn = !subsOn;
		applyTextTrack();
	}
	function applyTextTrack() {
		const tracks = video?.textTracks;
		if (!tracks) return;
		for (let i = 0; i < tracks.length; i++) tracks[i].mode = subsOn ? 'showing' : 'hidden';
	}

	/* --------------------------------------------------------- seekbar */
	let bar: HTMLDivElement | undefined = $state();
	function posFromEvent(e: PointerEvent): number {
		if (!bar) return 0;
		const rect = bar.getBoundingClientRect();
		const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
		return (x / rect.width) * (duration || 0);
	}
	function onBarDown(e: PointerEvent) {
		scrubbing = true;
		bar?.setPointerCapture(e.pointerId);
		seek(posFromEvent(e));
	}
	function onBarMove(e: PointerEvent) {
		if (scrubbing) seek(posFromEvent(e));
	}
	function onBarUp(e: PointerEvent) {
		if (scrubbing) {
			scrubbing = false;
			bar?.releasePointerCapture(e.pointerId);
			flushProgress();
		}
	}

	/* --------------------------------------------------- keyboard */
	function onKey(e: KeyboardEvent) {
		const t = e.target as HTMLElement;
		if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
		switch (e.key) {
			case ' ':
			case 'k':
				e.preventDefault();
				togglePlay();
				break;
			case 'ArrowLeft':
				seekBy(-5);
				break;
			case 'ArrowRight':
				seekBy(5);
				break;
			case 'j':
				seekBy(-10);
				break;
			case 'l':
				seekBy(10);
				break;
			case 'f':
				toggleFullscreen();
				break;
			case 'm':
				toggleMute();
				break;
			case 'c':
				if (hasSubtitles) toggleSubs();
				break;
			case 't':
				theater = !theater;
				break;
			default:
				if (/^[0-9]$/.test(e.key)) seek((+e.key / 10) * duration);
		}
	}

	/* ------------------------------------------------- controls autohide */
	let hideTimer: ReturnType<typeof setTimeout> | undefined;
	function nudgeControls() {
		controlsVisible = true;
		clearTimeout(hideTimer);
		hideTimer = setTimeout(() => {
			if (!paused && !scrubbing && !showSpeed) controlsVisible = false;
		}, 2500);
	}

	function segStyle(s: SponsorSegment): string {
		if (duration <= 0) return 'display:none';
		const left = (s.start / duration) * 100;
		const width = ((s.end - s.start) / duration) * 100;
		return `left:${left}%;width:${width}%;background:${SB_COLORS[s.category] ?? '#888'}`;
	}
	function chapterLeft(c: Chapter): string {
		return duration > 0 ? `left:${(c.startTime / duration) * 100}%` : 'display:none';
	}
</script>

<svelte:window onkeydown={onKey} />

<div
	bind:this={container}
	class="group relative overflow-hidden rounded-xl bg-black"
	class:cursor-none={!controlsVisible && !paused}
	onmousemove={nudgeControls}
	onpointermove={nudgeControls}
	role="region"
	aria-label="Video player"
>
	<!-- svelte-ignore a11y_media_has_caption -->
	<video
		bind:this={video}
		class="aspect-video w-full bg-black"
		src="/api/stream/{videoId}"
		poster="/api/thumb/{videoId}"
		autoplay
		bind:paused
		bind:volume
		bind:muted
		onloadedmetadata={onLoaded}
		ontimeupdate={onTimeUpdate}
		onclick={togglePlay}
		ondblclick={toggleFullscreen}
	>
		{#if hasSubtitles}
			<track kind="subtitles" src="/api/subs/{videoId}" srclang="en" label="English" />
		{/if}
	</video>

	{#if skipToast}
		<div class="absolute left-4 top-4 rounded-md bg-black/80 px-3 py-1.5 text-sm text-white">
			{skipToast}
		</div>
	{/if}

	{#if paused}
		<button
			class="absolute inset-0 grid place-items-center bg-black/20"
			onclick={togglePlay}
			aria-label="Play"
		>
			<span class="grid h-16 w-16 place-items-center rounded-full bg-black/60 text-white">
				<Icon name="play" size={32} />
			</span>
		</button>
	{/if}

	<!-- Controls -->
	<div
		class="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-3 pb-2 pt-8 transition-opacity duration-200"
		class:opacity-0={!controlsVisible}
		class:pointer-events-none={!controlsVisible}
	>
		<!-- Seekbar -->
		<div class="group/bar relative py-2">
			<div
				bind:this={bar}
				class="relative h-1 cursor-pointer rounded-full bg-white/25 transition-[height] group-hover/bar:h-1.5"
				onpointerdown={onBarDown}
				onpointermove={onBarMove}
				onpointerup={onBarUp}
				role="slider"
				aria-label="Seek"
				aria-valuemin={0}
				aria-valuemax={Math.round(duration)}
				aria-valuenow={Math.round(currentTime)}
				tabindex="0"
			>
				<!-- buffered -->
				<div class="absolute inset-y-0 left-0 rounded-full bg-white/30" style="width:{duration > 0 ? (buffered / duration) * 100 : 0}%"></div>
				<!-- sponsorblock segments -->
				{#each sponsorblock as s (s.uuid ?? s.start)}
					<div class="absolute inset-y-0 opacity-80" style={segStyle(s)}></div>
				{/each}
				<!-- played -->
				<div class="absolute inset-y-0 left-0 rounded-full bg-accent" style="width:{percent * 100}%"></div>
				<!-- chapter ticks -->
				{#each chapters as c (c.startTime)}
					{#if c.startTime > 0}
						<div class="absolute top-1/2 h-2.5 w-0.5 -translate-y-1/2 bg-black/60" style={chapterLeft(c)}></div>
					{/if}
				{/each}
				<!-- scrubber handle -->
				<div class="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent opacity-0 transition-opacity group-hover/bar:opacity-100" style="left:{percent * 100}%"></div>
			</div>
		</div>

		<!-- Buttons -->
		<div class="flex items-center gap-3 text-white">
			<button onclick={togglePlay} aria-label={paused ? 'Play' : 'Pause'} class="hover:text-accent">
				{#if paused}<Icon name="play" size={22} />{:else}<span class="text-lg leading-none">❚❚</span>{/if}
			</button>

			<button onclick={toggleMute} aria-label="Mute" class="hover:text-accent">
				<span class="text-sm">{muted || volume === 0 ? '🔇' : '🔊'}</span>
			</button>
			<input
				type="range" min="0" max="1" step="0.05" bind:value={volume}
				class="h-1 w-20 cursor-pointer accent-accent" aria-label="Volume"
			/>

			<span class="ml-1 text-xs tabular-nums text-white/90">
				{formatDuration(currentTime)} / {formatDuration(duration)}
			</span>

			{#if currentChapter}
				<span class="ml-1 max-w-[16rem] truncate text-xs text-white/70">· {currentChapter}</span>
			{/if}

			<div class="ml-auto flex items-center gap-3">
				{#if sponsorblock.length > 0}
					<button
						onclick={() => (autoSkip = !autoSkip)}
						class="chip {autoSkip ? 'text-accent' : 'text-white/60'}"
						title="Auto-skip SponsorBlock segments"
					>
						SB {autoSkip ? 'on' : 'off'}
					</button>
				{/if}

				{#if hasSubtitles}
					<button onclick={toggleSubs} class="text-xs font-semibold {subsOn ? 'text-accent' : 'text-white/70 hover:text-white'}" title="Subtitles (c)">CC</button>
				{/if}

				<div class="relative">
					<button onclick={() => (showSpeed = !showSpeed)} class="text-xs font-semibold text-white/80 hover:text-white" title="Playback speed">
						{rate}×
					</button>
					{#if showSpeed}
						<div class="absolute bottom-7 right-0 flex flex-col rounded-md bg-bg-soft py-1 text-sm shadow-xl">
							{#each RATES as r (r)}
								<button class="px-4 py-1 text-left hover:bg-bg-hover {r === rate ? 'text-accent' : ''}" onclick={() => setRate(r)}>{r}×</button>
							{/each}
						</div>
					{/if}
				</div>

				<button onclick={() => (theater = !theater)} class="hover:text-accent" title="Theater mode (t)" aria-label="Theater mode">
					<span class="text-sm">▭</span>
				</button>
				<button onclick={toggleFullscreen} class="hover:text-accent" title="Fullscreen (f)" aria-label="Fullscreen">
					<span class="text-sm">{fullscreen ? '🡼' : '⛶'}</span>
				</button>
			</div>
		</div>
	</div>
</div>
