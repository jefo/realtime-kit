import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { fileURLToPath } from "node:url";

export default defineConfig({
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
});
