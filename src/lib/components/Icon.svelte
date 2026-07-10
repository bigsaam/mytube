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
		play: 'M8 5v14l11-7z',
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
	fill={name === 'play' ? 'currentColor' : 'none'}
	stroke="currentColor"
	stroke-width="1.8"
	stroke-linecap="round"
	stroke-linejoin="round"
	class={cls}
	aria-hidden="true"
>
	<path {d} />
</svg>
