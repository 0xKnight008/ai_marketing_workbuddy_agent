import path from "path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

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
        contact: path.resolve(__dirname, "contact/index.html"),
        zhContact: path.resolve(__dirname, "zh/contact/index.html"),
        enContact: path.resolve(__dirname, "en/contact/index.html"),
        esContact: path.resolve(__dirname, "es/contact/index.html"),
      },
    },
  },
  plugins: [react()],
  server: {
    port: 3000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
