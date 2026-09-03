import path from "path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// https://vite.dev/config/
export default defineConfig({
  // The site is deployed at the origin root. Absolute assets keep nested SPA
  // routes such as /app/admin from resolving bundles under /app/assets.
  base: '/',
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
        privacy: path.resolve(__dirname, "privacy/index.html"),
        terms: path.resolve(__dirname, "terms/index.html"),
        zhPrivacy: path.resolve(__dirname, "zh/privacy/index.html"),
        zhTerms: path.resolve(__dirname, "zh/terms/index.html"),
        enPrivacy: path.resolve(__dirname, "en/privacy/index.html"),
        enTerms: path.resolve(__dirname, "en/terms/index.html"),
        esPrivacy: path.resolve(__dirname, "es/privacy/index.html"),
        esTerms: path.resolve(__dirname, "es/terms/index.html"),
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
