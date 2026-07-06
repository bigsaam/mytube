import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	plugins: [sveltekit()],
	server: {
		// better-sqlite3 / playwright are native / heavy; keep them external in dev SSR
		fs: { allow: ['..'] }
	},
	ssr: {
		external: ['better-sqlite3', 'playwright']
	},
	test: {
		include: ['src/**/*.{test,spec}.{js,ts}'],
		environment: 'node'
	}
});
