import { ProviderError } from "./errors";

const RESOLUTION_PATTERN = /^(?:[1-9]\d{0,3}|1D|1W|1M)$/;

export function assertResolution(value: string): string {
  if (!RESOLUTION_PATTERN.test(value)) {
    throw new ProviderError("unsupported_resolution", `Unsupported resolution: ${value}`, 400);
  }
  return value;
}

/** Approximate length of one bar in seconds. */
export function resolutionSeconds(resolution: string): number {
  assertResolution(resolution);
  switch (resolution) {
    case "1D":
      return 86_400;
    case "1W":
      return 604_800;
    case "1M":
      return 2_592_000;
    default:
      return Number(resolution) * 60;
  }
}
