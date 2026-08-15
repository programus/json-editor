import { svelte } from '@sveltejs/vite-plugin-svelte'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'
import { precompress } from './build/precompress'

// https://vite.dev/config/
export default defineConfig({
  plugins: [tailwindcss(), svelte(), precompress()],
  build: {
    // The main chunk is ~940 kB, dominated by CodeMirror inside
    // `svelte-jsoneditor`, which imports it statically. Splitting it out would
    // mean patching that dependency's internals, so the bundle stays as one
    // chunk and is served pre-compressed instead (~250 kB brotli over the wire).
    chunkSizeWarningLimit: 1024,
  },
})
