import type { EnvelopeItemHeader } from "@sentrylike/shared";

export interface ParsedEnvelope {
  header: Record<string, unknown>;
  items: Array<{ header: EnvelopeItemHeader; payload: Uint8Array }>;
}

const LF = 0x0a;

/**
 * Parses a Sentry envelope (https://develop.sentry.dev/sdk/data-model/envelopes/)
 * Format: envelope-header\n (item-header\n payload)* where payload length
 * comes from the item header `length` field, or runs until the next newline.
 */
export function parseEnvelope(data: Uint8Array): ParsedEnvelope {
  let offset = 0;

  const readLine = (): string => {
    const idx = data.indexOf(LF, offset);
    const end = idx === -1 ? data.length : idx;
    const line = new TextDecoder().decode(data.subarray(offset, end));
    offset = end + 1;
    return line;
  };

  const headerLine = readLine();
  if (!headerLine.trim()) throw new Error("empty envelope");
  const header = JSON.parse(headerLine);

  const items: ParsedEnvelope["items"] = [];
  while (offset < data.length) {
    if (data[offset] === LF) {
      offset++;
      continue;
    }
    const itemHeader: EnvelopeItemHeader = JSON.parse(readLine());
    let payload: Uint8Array;
    if (itemHeader.length != null) {
      payload = data.subarray(offset, offset + itemHeader.length);
      offset += itemHeader.length;
      if (data[offset] === LF) offset++;
    } else {
      const idx = data.indexOf(LF, offset);
      const end = idx === -1 ? data.length : idx;
      payload = data.subarray(offset, end);
      offset = end + 1;
    }
    items.push({ header: itemHeader, payload });
  }

  return { header, items };
}
