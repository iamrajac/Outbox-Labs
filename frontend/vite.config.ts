import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// The dev server proxies API + queue dashboard to the backend so cookies stay same-origin
// (this is also why the OAuth redirect URIs point at the frontend port).
const backend = process.env.BACKEND_URL ?? "http://localhost:4000";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: { "/api": backend, "/admin": backend },
  },
});
