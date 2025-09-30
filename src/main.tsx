import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Replace with your repo name
export default defineConfig({
  plugins: [react()],
  base: '/Test-Mocap-Webapp/',   // <-- IMPORTANT: repo slug
  build: {
    outDir: 'dist'               // or 'docs' if you prefer the docs branch style
  }
})
