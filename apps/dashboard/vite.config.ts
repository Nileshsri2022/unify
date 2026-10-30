import path from "node:path"
import { fileURLToPath } from "node:url"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// `unify ui --api-only` port — keep the dev proxy in sync with the CLI's
// default (7420) or an explicit $UNIFY_UI_PORT.
const apiPort = Number(process.env.UNIFY_UI_PORT) || 7420

const rootDir = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(rootDir, "./src"),
    },
  },
  server: {
    host: true,
    port: 5173,
    strictPort: true,
    // sandbox preview proxy (e2b.app) — dev only
    allowedHosts: true as const,
    // dev workflow: `unify ui --api-only` + `vite dev` → dashboard fetches
    // relative /api/* and vite forwards it to the unify API port.
    proxy: {
      "/api": `http://127.0.0.1:${apiPort}`,
    },
  },
})
