<script lang="ts">
  import type { ConnectionStatus } from "./types";

  interface Props {
    status: ConnectionStatus;
    label?: string;
    latencyMs?: number;
  }

  let { status, label, latencyMs }: Props = $props();

  const defaults: Record<ConnectionStatus, string> = {
    live: "Live",
    connecting: "Connecting",
    reconnecting: "Reconnecting",
    offline: "Offline",
  };

  const text = $derived(label ?? defaults[status]);
</script>

<span class="rtk-status" data-status={status} aria-live="polite">
  <span class="rtk-status-dot" aria-hidden="true"></span>
  <span class="rtk-status-text">{text}</span>
  {#if latencyMs !== undefined}
    <span class="rtk-status-latency">{Math.round(latencyMs)} ms</span>
  {/if}
</span>

<style>
  .rtk-status {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    padding: 4px 9px;
    border: 1px solid var(--rtk-border, #232b35);
    border-radius: 999px;
    background: var(--rtk-panel-2, #161c24);
    color: var(--rtk-muted, #8b95a3);
    font-size: 10px;
    letter-spacing: 0.04em;
    white-space: nowrap;
  }

  .rtk-status-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: currentColor;
  }

  .rtk-status-text {
    font-weight: 600;
    text-transform: uppercase;
  }

  .rtk-status-latency {
    color: var(--rtk-faint, #5c6675);
    font-family: var(--rtk-mono, monospace);
    font-variant-numeric: tabular-nums;
  }

  .rtk-status[data-status="live"] {
    color: var(--rtk-up, #3fb950);
  }

  .rtk-status[data-status="live"] .rtk-status-dot {
    animation: rtk-pulse 1.8s ease-in-out infinite;
  }

  .rtk-status[data-status="connecting"],
  .rtk-status[data-status="reconnecting"] {
    color: var(--rtk-accent, #d4af37);
  }

  .rtk-status[data-status="offline"] {
    color: var(--rtk-down, #f85149);
  }

  @keyframes rtk-pulse {
    0%,
    100% {
      opacity: 1;
      box-shadow: 0 0 0 0 rgba(63, 185, 80, 0.35);
    }
    50% {
      opacity: 0.65;
      box-shadow: 0 0 0 4px rgba(63, 185, 80, 0);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .rtk-status[data-status="live"] .rtk-status-dot {
      animation: none;
    }
  }
</style>
