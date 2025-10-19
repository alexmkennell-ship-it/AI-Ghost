import { defineConfig } from "vite";

export default defineConfig({
  base: "/AI-Ghost/",
});

export default defineConfig({
  root: ".",
  publicDir: "public",
  build: {
    outDir: "dist",
  },
  server: {
    open: true,
  },
});
