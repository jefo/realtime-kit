export class ProviderError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

export class UdfTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Provider did not answer within ${timeoutMs} ms.`);
    this.name = "UdfTimeoutError";
  }
}
