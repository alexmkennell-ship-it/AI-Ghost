import { defineConfig } from "vite";

export default defineConfig({
  base: "./", // ensures relative paths work for GitHub Pages
  build: {
    outDir: "dist",
    rollupOptions: {
      output: {
        manualChunks: undefined,
      },
    },
  },
  server: {
    port: 5173,
    open: true,
  },
});
