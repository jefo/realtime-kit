import type { OverflowPolicy } from "./types";

export type PushResult = "queued" | "delivered" | "overflow" | "closed";

/**
 * Async queue with a hard capacity. When nobody is reading, the queue drops
 * the oldest item (or closes the stream, depending on the policy) instead of
 * growing without bound.
 */
export class BoundedQueue<T> {
  private items: T[] = [];
  private waiters: Array<(result: IteratorResult<T>) => void> = [];
  private closed = false;
  private droppedCount = 0;
  private overflowed = false;

  constructor(
    private readonly capacity: number,
    private readonly overflow: OverflowPolicy = "drop-oldest",
  ) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new Error("Queue capacity must be an integer >= 1.");
    }
  }

  get size(): number {
    return this.items.length;
  }

  get dropped(): number {
    return this.droppedCount;
  }

  get isOverflowed(): boolean {
    return this.overflowed;
  }

  get isClosed(): boolean {
    return this.closed;
  }

  push(item: T): PushResult {
    if (this.closed) return "closed";

    const waiter = this.waiters.shift();
    if (waiter) {
      waiter({ value: item, done: false });
      return "delivered";
    }

    if (this.items.length >= this.capacity) {
      if (this.overflow === "disconnect") {
        this.overflowed = true;
        this.closeAfterDrain();
        return "closed";
      }
      this.items.shift();
      this.droppedCount += 1;
      this.items.push(item);
      return "overflow";
    }

    this.items.push(item);
    return "queued";
  }

  next(): Promise<IteratorResult<T>> {
    const item = this.items.shift();
    if (item !== undefined) {
      return Promise.resolve({ value: item, done: false });
    }
    if (this.closed) {
      return Promise.resolve({ value: undefined, done: true });
    }
    return new Promise((resolve) => {
      this.waiters.push(resolve);
    });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.items.length = 0;
    for (const waiter of this.waiters.splice(0)) {
      waiter({ value: undefined, done: true });
    }
  }

  /** Stop accepting new items, but let the reader drain what is already queued. */
  private closeAfterDrain(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.items.length === 0) {
      for (const waiter of this.waiters.splice(0)) {
        waiter({ value: undefined, done: true });
      }
    }
  }
}
