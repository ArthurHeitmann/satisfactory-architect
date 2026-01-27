import devtoolsJson from 'vite-plugin-devtools-json';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [sveltekit(), devtoolsJson()],
	optimizeDeps: {
		exclude: ['@bokuweb/zstd-wasm'],
		esbuildOptions: {
			target: 'esnext',
		},
	},
});
