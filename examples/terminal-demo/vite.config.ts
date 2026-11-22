import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { fileURLToPath } from "node:url";

export default defineConfig(({ command }) => ({
  // GitHub Pages serves the demo under /realtime-kit/. The base changes if the
  // repository is renamed; see RELEASE.md.
  base: command === "build" ? "/realtime-kit/" : "/",
  plugins: [svelte()],
  resolve: {
    alias: {
      "@rtkit/terminal-kit": fileURLToPath(
        new URL("../../packages/terminal-kit/src/lib/index.ts", import.meta.url),
      ),
    },
  },
  server: {
    port: 5190,
    strictPort: true,
  },
}));
