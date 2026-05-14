import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  server: {
    watch: {
      usePolling: true,
      interval: 250,
      ignored: ['**/node_modules/**', '**/dist/**'],
    },
  },
})
