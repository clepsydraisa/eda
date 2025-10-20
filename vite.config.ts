import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// If you publish under a subpath like https://username.github.io/repo,
// set base to '/repo/'. We'll override via env (VITE_BASE) in CI.
export default defineConfig({
  plugins: [react()],
  base: process.env.VITE_BASE || '/',
});


