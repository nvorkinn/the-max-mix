import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    // Spotify requires a loopback IP literal for http redirect URIs, so dev serves on exactly http://127.0.0.1:5173/
    // (register that address in the Spotify dashboard) and fails rather than moving to another port.
    host: '127.0.0.1',
    port: 5173,
    strictPort: true
  },
  preview: {
    // The same reason: `npm start` (vite preview) serves on exactly http://127.0.0.1:4173/.
    host: '127.0.0.1',
    port: 4173,
    strictPort: true
  }
});
