import { svelte } from '@sveltejs/vite-plugin-svelte'
import { defineConfig } from 'vitest/config'

// Kept separate from `vite.config.ts` so the app config stays a plain Vite
// config (its `defineConfig` does not accept a `test` block) and Tailwind is
// not compiled for every test run.
export default defineConfig({
  plugins: [
    svelte({
      // `hot` rewrites components for HMR, which confuses the test runner.
      hot: false,
    }),
  ],
  // Component tests need the browser build of Svelte so runes work under jsdom.
  resolve: {
    conditions: ['browser'],
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/lib/**/*.ts', 'src/lib/**/*.svelte'],
      reporter: ['text', 'html'],
    },
  },
})
