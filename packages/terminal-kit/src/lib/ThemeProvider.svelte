<script lang="ts">
  import type { Snippet } from "svelte";

  interface Props {
    theme?: "dark" | "light";
    density?: "compact" | "comfortable";
    /** Any CSS color. Overrides `--rtk-accent`. */
    accent?: string;
    class?: string;
    children: Snippet;
  }

  let {
    theme = "dark",
    density = "compact",
    accent,
    class: className = "",
    children,
  }: Props = $props();
</script>

<div
  class="rtk-root {className}"
  class:rtk-light={theme === "light"}
  data-theme={theme}
  data-density={density}
  style:--rtk-accent={accent}
>
  {@render children()}
</div>

<style>
  .rtk-root {
    --rtk-bg: #0b0e11;
    --rtk-panel: #11161c;
    --rtk-panel-2: #161c24;
    --rtk-panel-3: #1c242e;
    --rtk-border: #232b35;
    --rtk-border-strong: #313c4a;
    --rtk-text: #e6e9ee;
    --rtk-muted: #8b95a3;
    --rtk-faint: #7f8a99;
    --rtk-up: #3fb950;
    --rtk-down: #f85149;
    --rtk-up-soft: rgba(63, 185, 80, 0.16);
    --rtk-down-soft: rgba(248, 81, 73, 0.16);
    --rtk-accent: #d4af37;
    --rtk-accent-soft: rgba(212, 175, 55, 0.14);
    --rtk-hover: rgba(255, 255, 255, 0.035);
    --rtk-selected: rgba(212, 175, 55, 0.1);
    --rtk-shadow: 0 12px 32px rgba(0, 0, 0, 0.32);
    --rtk-radius: 10px;
    --rtk-radius-sm: 6px;
    --rtk-font: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    --rtk-mono: "JetBrains Mono", "SFMono-Regular", ui-monospace, monospace;
    --rtk-font-size: 12px;
    --rtk-row-pad: 6px 10px;
    --rtk-gap: 8px;

    color: var(--rtk-text);
    background: var(--rtk-bg);
    font-family: var(--rtk-font);
    font-size: var(--rtk-font-size);
    color-scheme: dark;
    min-height: 100%;
  }

  .rtk-root[data-density="comfortable"] {
    --rtk-font-size: 13px;
    --rtk-row-pad: 10px 14px;
    --rtk-gap: 12px;
  }

  .rtk-root[data-theme="light"] {
    --rtk-bg: #f4f6f8;
    --rtk-panel: #ffffff;
    --rtk-panel-2: #f0f3f6;
    --rtk-panel-3: #e7ebf0;
    --rtk-border: #d8dee6;
    --rtk-border-strong: #c3ccd7;
    --rtk-text: #121820;
    --rtk-muted: #5f6b7a;
    --rtk-faint: #626d7b;
    --rtk-up: #128a3a;
    --rtk-down: #c62828;
    --rtk-up-soft: rgba(18, 138, 58, 0.12);
    --rtk-down-soft: rgba(198, 40, 40, 0.12);
    --rtk-accent: #8a6d1f;
    --rtk-accent-soft: rgba(138, 109, 31, 0.12);
    --rtk-hover: rgba(0, 0, 0, 0.035);
    --rtk-selected: rgba(138, 109, 31, 0.1);
    --rtk-shadow: 0 12px 32px rgba(20, 30, 40, 0.12);
    color-scheme: light;
  }
</style>
