<script lang="ts">
	// Minimal inline icon set (stroke-based, currentColor). Keeps the bundle free
	// of an icon dependency and lets Tailwind size/color everything.
	interface Props {
		name: string;
		size?: number;
		class?: string;
	}
	let { name, size = 20, class: cls = '' }: Props = $props();

	const paths: Record<string, string> = {
		feed: 'M4 6h16M4 12h16M4 18h10',
		'watch-later': 'M12 7v5l3 2M12 3a9 9 0 100 18 9 9 0 000-18z',
		library: 'M4 5h10M4 10h10M4 15h6M17 5v14l4-3',
		channels: 'M12 12a4 4 0 100-8 4 4 0 000 8zM4 20a8 8 0 0116 0',
		downloads: 'M12 3v12m0 0l-4-4m4 4l4-4M4 19h16',
		settings:
			'M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 13a7.9 7.9 0 000-2l2-1.5-2-3.5-2.4 1a7.9 7.9 0 00-1.7-1L14 3h-4l-.6 2.5a7.9 7.9 0 00-1.7 1l-2.4-1-2 3.5L3.6 11a7.9 7.9 0 000 2l-2 1.5 2 3.5 2.4-1a7.9 7.9 0 001.7 1L10 21h4l.6-2.5a7.9 7.9 0 001.7-1l2.4 1 2-3.5L19.4 13z',
		plus: 'M12 5v14M5 12h14',
		menu: 'M4 6h16M4 12h16M4 18h16',
		play: 'M8 5v14l11-7z',
		pause: 'M8 5h3v14H8zM13 5h3v14h-3z',
		prev: 'M7 5v14M20 5l-11 7 11 7z',
		next: 'M17 5v14M4 5l11 7-11 7z',
		volume: 'M4 9v6h4l5 4V5L8 9H4M16 9.5a3 3 0 010 5M18.5 7a6.5 6.5 0 010 10',
		'volume-mute': 'M4 9v6h4l5 4V5L8 9H4M22 9.5l-5 5M17 9.5l5 5',
		repeat: 'M4 12V9a3 3 0 013-3h11m-2-3l3 3-3 3M20 12v3a3 3 0 01-3 3H6m2 3l-3-3 3-3',
		airplay: 'M6 17H5a2 2 0 01-2-2V7a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-1M12 15l4 5H8z',
		theater: 'M4 7h16a1 1 0 011 1v8a1 1 0 01-1 1H4a1 1 0 01-1-1V8a1 1 0 011-1z',
		fullscreen: 'M4 9V5a1 1 0 011-1h4M20 9V5a1 1 0 00-1-1h-4M4 15v4a1 1 0 001 1h4M20 15v4a1 1 0 01-1 1h-4',
		'fullscreen-exit': 'M9 4v4a1 1 0 01-1 1H4M15 4v4a1 1 0 001 1h4M9 20v-4a1 1 0 00-1-1H4M15 20v-4a1 1 0 011-1h4',
		check: 'M5 13l4 4L19 7',
		x: 'M6 6l12 12M18 6L6 18',
		clock: 'M12 7v5l3 2M12 3a9 9 0 100 18 9 9 0 000-18z',
		trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
		pin: 'M12 3l2 6h6l-5 4 2 7-5-4-5 4 2-7-5-4h6z',
		search: 'M11 4a7 7 0 100 14 7 7 0 000-14zM21 21l-5-5',
		retry: 'M4 12a8 8 0 018-8 8 8 0 017 4M20 4v5h-5M20 12a8 8 0 01-8 8 8 8 0 01-7-4M4 20v-5h5',
		grab: 'M12 3v10m0 0l-3.5-3.5M12 13l3.5-3.5M5 21h14',
		share: 'M4 12v7a1 1 0 001 1h14a1 1 0 001-1v-7M16 6l-4-4-4 4M12 2v13',
		discover: 'M12 3a9 9 0 100 18 9 9 0 000-18zM15.5 8.5l-2 5-5 2 2-5 5-2z',
		warning: 'M12 9v4m0 4h.01M10.3 3.9l-8 14A2 2 0 004 21h16a2 2 0 001.7-3l-8-14a2 2 0 00-3.4 0z',
		// "Not interested" — circle-slash, deliberately distinct from `x` (dismiss).
		block: 'M12 3a9 9 0 100 18 9 9 0 000-18zM5.6 5.6l12.8 12.8'
	};
	let d = $derived(paths[name] ?? '');
</script>

<svg
	xmlns="http://www.w3.org/2000/svg"
	width={size}
	height={size}
	viewBox="0 0 24 24"
	fill={name === 'play' || name === 'pause' ? 'currentColor' : 'none'}
	stroke="currentColor"
	stroke-width="1.8"
	stroke-linecap="round"
	stroke-linejoin="round"
	class={cls}
	aria-hidden="true"
>
	<path {d} />
</svg>
