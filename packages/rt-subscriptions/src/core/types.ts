export interface Subscription {
  topic: string;
  params?: Record<string, unknown>;
}

export interface ResolvedSubscription {
  topic: string;
  params: Record<string, unknown>;
  key: string;
}

export interface EventEnvelope<T = unknown> {
  /** Monotonic per session. Resets when a new session is created. */
  id: number;
  key: string;
  topic: string;
  data: T;
}

export interface SessionInfo {
  id: string;
  subscriptions: ResolvedSubscription[];
  createdAt: number;
}

export interface TopicHooks {
  /** Called when the first session subscribes to this exact key. */
  onFirstSubscriber?: (sub: ResolvedSubscription) => void | Promise<void>;
  /** Called when the last session unsubscribes from this exact key. */
  onLastSubscriber?: (sub: ResolvedSubscription) => void | Promise<void>;
}

export type OverflowPolicy = "drop-oldest" | "disconnect";

export interface GatewayOptions {
  /** How long a detached session is kept for reconnects. 0 disables the grace period. */
  sessionTtlMs?: number;
  /** Upper bound of subscriptions in one session. */
  maxSubscriptionsPerSession?: number;
  /** Upper bound of queued events per session. */
  maxQueuePerSession?: number;
  /** What to do when a session queue is full. */
  overflow?: OverflowPolicy;
  /** Reject subscriptions for topics without registered hooks. */
  requireRegisteredTopics?: boolean;
  /** Sweep interval for expired sessions. */
  sweepIntervalMs?: number;
  now?: () => number;
  idFactory?: () => string;
  onError?: (error: unknown, context: string) => void;
}

export interface GatewayStats {
  sessions: number;
  attached: number;
  subscriptions: number;
  queued: number;
  dropped: number;
  missed: number;
  published: number;
}

export type SessionCloseReason = "client" | "expired" | "overflow" | "shutdown";
