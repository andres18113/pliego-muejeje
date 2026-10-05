import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [tailwindcss(), react()],
  resolve: {
    alias: {
      "@": new URL("./src", import.meta.url).pathname,
    },
  },
  server: {
    fs: { allow: [new URL(".", import.meta.url).pathname, new URL("../shared", import.meta.url).pathname] },
    proxy: {
      "/api": {
        target: process.env.PLIEGO_API_PROXY_TARGET || "http://localhost:8080",
        changeOrigin: true,
      },
    },
  },
});
