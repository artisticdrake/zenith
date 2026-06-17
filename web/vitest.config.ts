import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    // Dummy env so lib/supabase.ts (which throws on missing keys) imports cleanly
    // and components reading import.meta.env have stable values under test.
    env: {
      VITE_SUPABASE_URL: 'http://localhost:54321',
      VITE_SUPABASE_ANON_KEY: 'test-anon-key',
      VITE_API_URL: 'http://localhost:3000',
    },
    // Only Vitest specs — the legacy tsx node:assert specs (*.spec.ts) run via tsx.
    include: ['tests/**/*.test.{ts,tsx}'],
  },
});
