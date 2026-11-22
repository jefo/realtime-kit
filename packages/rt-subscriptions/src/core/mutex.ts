/**
 * Serializes async work per key. Used to make subscription refcounts and
 * lifecycle hooks atomic: without it, two concurrent creates can both skip
 * `onFirstSubscriber`, or a close can race a fresh subscriber.
 */
export class AsyncKeyedMutex {
  private readonly tails = new Map<string, Promise<void>>();

  async run<T>(key: string, fn: () => Promise<T> | T): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => gate);
    this.tails.set(key, tail);

    await previous;
    try {
      return await fn();
    } finally {
      release();
      if (this.tails.get(key) === tail) this.tails.delete(key);
    }
  }

  /** Acquire several keys in a stable order to avoid deadlocks. */
  async runMany<T>(keys: string[], fn: () => Promise<T> | T): Promise<T> {
    const unique = [...new Set(keys)].sort();
    const acquire = (index: number): Promise<T> => {
      if (index >= unique.length) return Promise.resolve().then(fn);
      return this.run(unique[index] as string, () => acquire(index + 1));
    };
    return acquire(0);
  }
}
