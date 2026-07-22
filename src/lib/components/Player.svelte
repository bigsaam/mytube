<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import Icon from './Icon.svelte';
	import { formatDuration } from '$lib/format';
	import type { Chapter, SponsorSegment } from '$lib/server/db/schema';

	interface QueueItem {
		videoId: string;
		title: string;
	}

	interface Props {
		videoId: string;
		/** Shown on the OS lock-screen / notification media controls. */
		title?: string;
		channelName?: string | null;
		durationSeconds?: number | null;
		hasSubtitles?: boolean;
		chapters?: Chapter[];
		sponsorblock?: SponsorSegment[];
		positionSeconds?: number;
		autoSkipDefault?: boolean;
		theater?: boolean;
		/** Public share mode: no server-side progress/history writes, and media
		 * is fetched from the scoped `/s/…` URLs below instead of `/api/…`. */
		share?: boolean;
		streamSrc?: string;
		posterSrc?: string;
		subsSrc?: string;
		/** Ordered play-queue for autoplay-next + repeat (empty = single video). */
		queue?: QueueItem[];
		/** The `?list=` context to carry when navigating between queued videos. */
		listParam?: string | null;
	}
	let {
		videoId,
		title,
		channelName = null,
		durationSeconds = null,
		hasSubtitles = false,
		chapters = [],
		sponsorblock = [],
		positionSeconds = 0,
		autoSkipDefault = true,
		theater = $bindable(false),
		share = false,
		streamSrc,
		posterSrc,
		subsSrc,
		queue = [],
		listParam = null
	}: Props = $props();

	/* -------------------------------------------------------- play queue */
	let queueIndex = $derived(queue.findIndex((q) => q.videoId === videoId));
	let hasQueue = $derived(queue.length > 1 && queueIndex >= 0);
	// Repeat the whole queue: at the end of the list, wrap back to the first.
	let repeat = $state(false);

	function queueHref(item: QueueItem): string {
		const q = listParam ? `?list=${encodeURIComponent(listParam)}` : '';
		return `/watch/${item.videoId}${q}`;
	}
	function goToIndex(i: number) {
		const item = queue[i];
		if (item) goto(queueHref(item));
	}
	function playNext() {
		if (!hasQueue) return;
		if (queueIndex < queue.length - 1) goToIndex(queueIndex + 1);
		else if (repeat) goToIndex(0);
	}
	function playPrev() {
		if (!hasQueue) return;
		// Restart current track if we're past the intro, else step back.
		if ((video?.currentTime ?? 0) > 3) seek(0);
		else if (queueIndex > 0) goToIndex(queueIndex - 1);
		else if (repeat) goToIndex(queue.length - 1);
	}
	function onEnded() {
		flushProgress(true);
		if (repeat && !hasQueue) {
			// Single video on repeat.
			if (video) {
				video.currentTime = 0;
				video.play();
			}
			return;
		}
		if (hasQueue) playNext();
	}

	/* ---------------------------------------------------------- AirPlay */
	// WebKit Remote Playback (Safari on iOS/macOS/iPadOS). Undefined elsewhere.
	let airplayAvailable = $state(false);
	function showAirPlayPicker() {
		// @ts-expect-error — WebKit-only API, not in lib.dom types.
		video?.webkitShowPlaybackTargetPicker?.();
	}

	/* ------------------------------------------------- OS media session */
	// Lock-screen / notification-shade controls + artwork + headset buttons
	// on iOS and Android. No-op where unsupported (older Safari, etc.).
	function setupMediaSession() {
		if (!('mediaSession' in navigator)) return;
		const ms = navigator.mediaSession;
		try {
			ms.metadata = new MediaMetadata({
				title: title ?? 'MyTube',
				artist: channelName ?? '',
				artwork: [
					{ src: posterUrl, sizes: '512x512', type: 'image/jpeg' },
					{ src: posterUrl, sizes: '1280x720', type: 'image/jpeg' }
				]
			});
		} catch {
			/* MediaMetadata construction can throw on odd artwork URLs — ignore. */
		}
		const set = (action: MediaSessionAction, handler: MediaSessionActionHandler | null) => {
			try {
				ms.setActionHandler(action, handler);
			} catch {
				/* Not every UA supports every action (e.g. seekto). */
			}
		};
		set('play', () => video?.play());
		set('pause', () => video?.pause());
		set('seekbackward', (d) => seekBy(-(d.seekOffset ?? 10)));
		set('seekforward', (d) => seekBy(d.seekOffset ?? 10));
		set('seekto', (d) => {
			if (d.seekTime == null) return;
			if (d.fastSeek && video?.fastSeek) video.fastSeek(d.seekTime);
			else seek(d.seekTime);
		});
		// Only expose prev/next when there's actually a queue to move through.
		set('previoustrack', hasQueue ? () => playPrev() : null);
		set('nexttrack', hasQueue ? () => playNext() : null);
	}

	function updatePositionState() {
		if (!('mediaSession' in navigator) || !navigator.mediaSession.setPositionState) return;
		if (!(duration > 0) || !isFinite(duration)) return;
		try {
			navigator.mediaSession.setPositionState({
				duration,
				playbackRate: rate || 1,
				position: Math.min(Math.max(currentTime, 0), duration)
			});
		} catch {
			/* Ignore transient invalid-state errors during load. */
		}
	}

	// Keep the OS control's play/pause glyph in sync with actual state.
	$effect(() => {
		if ('mediaSession' in navigator) {
			navigator.mediaSession.playbackState = paused ? 'paused' : 'playing';
		}
	});

	let streamUrl = $derived(streamSrc ?? `/api/stream/${videoId}`);
	let posterUrl = $derived(posterSrc ?? `/api/thumb/${videoId}`);
	let subsUrl = $derived(subsSrc ?? `/api/subs/${videoId}`);

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
		const onFs = () => {
			const wk = (document as unknown as { webkitFullscreenElement?: Element })
				.webkitFullscreenElement;
			fullscreen = (document.fullscreenElement ?? wk) === container;
		};
		document.addEventListener('fullscreenchange', onFs);
		document.addEventListener('webkitfullscreenchange', onFs);
		// iPhone native video fullscreen fires these on the <video> element.
		const onVideoFsBegin = () => (fullscreen = true);
		const onVideoFsEnd = () => (fullscreen = false);
		video?.addEventListener('webkitbeginfullscreen', onVideoFsBegin);
		video?.addEventListener('webkitendfullscreen', onVideoFsEnd);
		const beacon = () => flushProgress(true);
		document.addEventListener('visibilitychange', () => {
			if (document.hidden) flushProgress();
		});
		window.addEventListener('beforeunload', beacon);
		const ping = setInterval(() => {
			if (!paused) flushProgress();
		}, 5000);
		// AirPlay: Safari fires this when a route (Apple TV, AirPlay speaker) appears.
		const onAirplay = (e: Event) => {
			// @ts-expect-error — WebKit-only event payload.
			airplayAvailable = e.availability === 'available';
		};
		// Non-standard attribute (not in the HTML typings) — set it imperatively so
		// Safari keeps its inline AirPlay affordance available on the element.
		video?.setAttribute('x-webkit-airplay', 'allow');
		video?.addEventListener('webkitplaybacktargetavailabilitychanged', onAirplay);
		setupMediaSession();
		return () => {
			document.removeEventListener('fullscreenchange', onFs);
			document.removeEventListener('webkitfullscreenchange', onFs);
			video?.removeEventListener('webkitbeginfullscreen', onVideoFsBegin);
			video?.removeEventListener('webkitendfullscreen', onVideoFsEnd);
			window.removeEventListener('beforeunload', beacon);
			video?.removeEventListener('webkitplaybacktargetavailabilitychanged', onAirplay);
			clearInterval(ping);
			flushProgress();
			// Release the media-session handlers so the next page starts clean.
			if ('mediaSession' in navigator) {
				const ms = navigator.mediaSession;
				for (const a of ['play', 'pause', 'seekbackward', 'seekforward', 'seekto', 'previoustrack', 'nexttrack'] as const) {
					try {
						ms.setActionHandler(a, null);
					} catch {
						/* ignore */
					}
				}
				ms.metadata = null;
			}
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
		updatePositionState();
	}

	/* ----------------------------------------------------- progress sync */
	let lastSent = 0;
	function flushProgress(useBeacon = false) {
		if (share) return; // public share: never write watch progress back
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
		updatePositionState();
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
		const doc = document as unknown as {
			webkitFullscreenElement?: Element;
			webkitExitFullscreen?: () => void;
		};
		const el = container as unknown as { webkitRequestFullscreen?: () => void };
		// iPhone Safari: the standard `webkitEnterFullscreen` lives on the <video>,
		// not the container, and there's no div-level fullscreen at all.
		const v = video as unknown as { webkitEnterFullscreen?: () => void };

		if (document.fullscreenElement || doc.webkitFullscreenElement) {
			(document.exitFullscreen ?? doc.webkitExitFullscreen)?.call(document);
			return;
		}
		if (container.requestFullscreen) {
			container.requestFullscreen();
		} else if (el.webkitRequestFullscreen) {
			el.webkitRequestFullscreen();
		} else if (v.webkitEnterFullscreen) {
			// iPhone: hands off to the native video player (its own controls).
			v.webkitEnterFullscreen();
		}
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

	/* ----------------------------------------------- touch gestures */
	// Double-tap the left/right third to seek ∓10s (like the YouTube app),
	// the middle to toggle fullscreen; a single tap shows/hides the controls.
	// We handle touch explicitly and preventDefault so the synthesized mouse
	// click (which would toggle play) doesn't also fire.
	let lastTouchAt = 0;
	let tapTimer: ReturnType<typeof setTimeout> | undefined;
	function onVideoTouchEnd(e: TouchEvent) {
		if (!video) return;
		const touch = e.changedTouches[0];
		if (!touch) return;
		e.preventDefault();
		const rect = video.getBoundingClientRect();
		const x = touch.clientX - rect.left;
		const w = rect.width;
		const now = e.timeStamp;
		if (now - lastTouchAt < 300) {
			// Double tap.
			clearTimeout(tapTimer);
			lastTouchAt = 0;
			if (x < w * 0.35) {
				seekBy(-10);
				toast('« 10s');
			} else if (x > w * 0.65) {
				seekBy(10);
				toast('10s »');
			} else {
				toggleFullscreen();
			}
			return;
		}
		lastTouchAt = now;
		// Defer the single-tap action so a second tap can upgrade it to a seek.
		clearTimeout(tapTimer);
		tapTimer = setTimeout(() => {
			if (controlsVisible && !paused) controlsVisible = false;
			else nudgeControls();
		}, 280);
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
		if (!controlsVisible) controlsVisible = true;
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
	onpointermove={nudgeControls}
	role="region"
	aria-label="Video player"
>
	<!-- svelte-ignore a11y_media_has_caption -->
	<video
		bind:this={video}
		class="aspect-video w-full bg-black"
		style="touch-action: manipulation"
		src={streamUrl}
		poster={posterUrl}
		autoplay
		playsinline
		bind:paused
		bind:volume
		bind:muted
		onloadedmetadata={onLoaded}
		ontimeupdate={onTimeUpdate}
		onended={onEnded}
		onclick={togglePlay}
		ondblclick={toggleFullscreen}
		ontouchend={onVideoTouchEnd}
	>
		{#if hasSubtitles}
			<track kind="subtitles" src={subsUrl} srclang="en" label="English" />
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
			{#if hasQueue}
				<button onclick={playPrev} aria-label="Previous" title="Previous" class="text-sm hover:text-accent">⏮</button>
			{/if}

			<button onclick={togglePlay} aria-label={paused ? 'Play' : 'Pause'} class="hover:text-accent">
				{#if paused}<Icon name="play" size={22} />{:else}<span class="text-lg leading-none">❚❚</span>{/if}
			</button>

			{#if hasQueue}
				<button onclick={playNext} aria-label="Next" title="Next" class="text-sm hover:text-accent">⏭</button>
			{/if}

			<button onclick={toggleMute} aria-label="Mute" class="hover:text-accent">
				<span class="text-sm">{muted || volume === 0 ? '🔇' : '🔊'}</span>
			</button>
			<input
				type="range" min="0" max="1" step="0.05" bind:value={volume}
				class="hidden h-1 w-20 cursor-pointer accent-accent sm:block" aria-label="Volume"
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

				{#if hasQueue}
					<span class="text-xs tabular-nums text-white/60" title="Position in queue">{queueIndex + 1}/{queue.length}</span>
				{/if}

				{#if !share}
					<button
						onclick={() => (repeat = !repeat)}
						class="text-sm {repeat ? 'text-accent' : 'text-white/70 hover:text-white'}"
						title={hasQueue ? 'Repeat queue' : 'Repeat'}
						aria-label="Repeat"
					>🔁</button>
				{/if}

				{#if airplayAvailable}
					<button onclick={showAirPlayPicker} class="text-sm hover:text-accent" title="AirPlay" aria-label="AirPlay">📺</button>
				{/if}

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
