export interface ParsedSseEvent {
  id?: string;
  event?: string;
  data: string;
  retry?: number;
}

/**
 * Incremental `text/event-stream` parser. Feed it decoded chunks; it returns
 * complete events and keeps the partial tail internally.
 */
export class SseParser {
  private buffer = "";

  push(chunk: string): ParsedSseEvent[] {
    this.buffer = normalizeNewlines(this.buffer + chunk);

    const events: ParsedSseEvent[] = [];
    let boundary = this.buffer.indexOf("\n\n");
    while (boundary !== -1) {
      const block = this.buffer.slice(0, boundary);
      this.buffer = this.buffer.slice(boundary + 2);
      const event = parseBlock(block);
      if (event) events.push(event);
      boundary = this.buffer.indexOf("\n\n");
    }
    return events;
  }

  get pending(): string {
    return this.buffer;
  }

  reset(): void {
    this.buffer = "";
  }
}

function parseBlock(block: string): ParsedSseEvent | null {
  let id: string | undefined;
  let event: string | undefined;
  let retry: number | undefined;
  let hasData = false;
  const data: string[] = [];

  for (const line of block.split("\n")) {
    if (line === "" || line.startsWith(":")) continue;

    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);

    switch (field) {
      case "id":
        if (!value.includes("\0")) id = value;
        break;
      case "event":
        event = value;
        break;
      case "data":
        data.push(value);
        hasData = true;
        break;
      case "retry": {
        const parsed = Number(value);
        if (Number.isInteger(parsed) && parsed >= 0) retry = parsed;
        break;
      }
      default:
        break;
    }
  }

  if (!hasData && event === undefined) return null;

  const result: ParsedSseEvent = { data: data.join("\n") };
  if (id !== undefined) result.id = id;
  if (event !== undefined) result.event = event;
  if (retry !== undefined) result.retry = retry;
  return result;
}

/**
 * Convert CRLF and bare CR to LF. A trailing CR is kept because the next
 * chunk may start with LF.
 */
function normalizeNewlines(input: string): string {
  let out = "";
  for (let i = 0; i < input.length; i += 1) {
    const ch = input.charAt(i);
    if (ch !== "\r") {
      out += ch;
      continue;
    }
    if (i === input.length - 1) {
      out += "\r";
      break;
    }
    if (input.charAt(i + 1) === "\n") i += 1;
    out += "\n";
  }
  return out;
}
