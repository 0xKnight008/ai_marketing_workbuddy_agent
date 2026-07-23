import path from "path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { inspectAttr } from 'kimi-plugin-inspect-react'

// https://vite.dev/config/
export default defineConfig({
  base: './',
  build: {
    rollupOptions: {
      input: {
        root: path.resolve(__dirname, "index.html"),
        zh: path.resolve(__dirname, "zh/index.html"),
        en: path.resolve(__dirname, "en/index.html"),
        es: path.resolve(__dirname, "es/index.html"),
      },
    },
  },
  plugins: [inspectAttr(), react()],
  server: {
    port: 3000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
