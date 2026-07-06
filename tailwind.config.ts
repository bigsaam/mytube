import type { Config } from 'tailwindcss';

export default {
	content: ['./src/**/*.{html,js,svelte,ts}'],
	darkMode: 'class',
	theme: {
		extend: {
			colors: {
				// Dense, calm dark palette — no platform loudness.
				bg: {
					DEFAULT: '#0f0f0f',
					soft: '#181818',
					raised: '#212121',
					hover: '#2a2a2a'
				},
				line: '#303030',
				fg: {
					DEFAULT: '#f1f1f1',
					muted: '#aaaaaa',
					faint: '#717171'
				},
				accent: {
					DEFAULT: '#3ea6ff',
					soft: '#263850'
				}
			},
			fontFamily: {
				sans: ['Inter', 'system-ui', 'sans-serif']
			}
		}
	},
	plugins: []
} satisfies Config;
