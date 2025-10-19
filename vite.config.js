import { defineConfig } from "vite";

export default defineConfig({
  base: "/AI-Ghost/",
  root: ".",
  publicDir: "public",
  build: {
    outDir: "dist",
    sourcemap: false,
  },
  server: {
    open: true,
  },
});
