import path from 'path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { viteSingleFile } from 'vite-plugin-singlefile'

// Preview-only build: everything (all lazy chunks too) inlined into one HTML
// file so it opens straight from disk — no server needed.
export default defineConfig({
  base: './',
  define: {
    'import.meta.env.VITE_ROUTER': JSON.stringify('hash'),
  },
  plugins: [react(), viteSingleFile()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    outDir: 'dist-single',
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
  },
})
