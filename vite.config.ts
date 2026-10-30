import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  base: '/threejsExample/',
  plugins: [vue()],
  server: {
    watch: { ignored: ['**/articles/**'] },
  },
})
