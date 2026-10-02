import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  // `vite build --mode pages` targets GitHub Pages at https://maftunashareef.github.io/ilmora-demo/
  base: mode === 'pages' ? '/ilmora-demo/' : '/',
  plugins: [react(), tailwindcss()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes('node_modules/three') || id.includes('@react-three')) return 'three'
        },
      },
    },
  },
}))
