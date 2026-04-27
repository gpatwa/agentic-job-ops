import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const API_PORT = Number(process.env.API_PORT ?? 8787);

export default defineConfig({
  plugins: [react()],
  server: {
    // Proxy /api/* to the local API server in dev so the frontend
    // can talk to it via same-origin without CORS gymnastics.
    // Production deployment should put the API behind the same
    // origin (or configure CORS via WEB_ORIGIN on the server) so
    // the browser code can keep using relative /api URLs.
    proxy: {
      "/api": {
        target: `http://127.0.0.1:${API_PORT}`,
        changeOrigin: true,
        // Don't fail the dev page just because the API is offline —
        // the frontend has a deterministic fallback path.
        configure: (proxy) => {
          proxy.on("error", () => {
            // Swallow; the API client handles 5xx/connection errors.
          });
        }
      }
    }
  },
  test: {
    environment: "node"
  }
});
