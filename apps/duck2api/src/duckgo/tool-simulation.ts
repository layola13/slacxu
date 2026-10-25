// Port of E:/projects/duck2api/internal/duckgo/request.go:625-1019
// ToolSimulationStream incremental playgame parser. Byte-semantics follow Go:
// marker `{"playgame":` with whitespace-tolerant pretty-print matching,
// Windows-command JSON repair, `call_playgame_N` IDs, separator skipping.
import type { ToolCall } from "./response.js";

export interface ToolSimulationPart {
  text?: string;
  toolCall?: ToolCall;
}

const PLAYGAME_MARKER = `{"playgame":`;
const MAX_PLAYGAME_PENDING = 256 * 1024;

function isJSONWhitespaceChar(ch: string): boolean {
  return ch === " " || ch === "\n" || ch === "\r" || ch === "\t";
}

function findPlaygameMarker(value: string): number {
  for (let offset = 0; offset < value.length; ) {
    const relative = value.indexOf("{", offset);
    if (relative < 0) return -1;
    const index = relative;
    let cursor = index + 1;
    while (cursor < value.length && isJSONWhitespaceChar(value[cursor]!)) cursor++;
    if (cursor >= value.length) return -1;
    if (!value.startsWith(`"playgame"`, cursor)) {
      offset = index + 1;
      continue;
    }
    cursor += `"playgame"`.length;
    while (cursor < value.length && isJSONWhitespaceChar(value[cursor]!)) cursor++;
    if (cursor >= value.length || value[cursor] !== ":") {
      offset = index + 1;
      continue;
    }
    return index;
  }
  return -1;
}

function suffixMarkerPrefixLength(value: string, marker: string): number {
  let max = value.length;
  if (max >= marker.length) max = marker.length - 1;
  for (let length = max; length > 0; length--) {
    if (value.endsWith(marker.slice(0, length))) return length;
  }
  return 0;
}

function suffixPlaygamePrefixLength(value: string): number {
  const lastBrace = value.lastIndexOf("{");
  if (lastBrace < 0) return 0;
  let suffix = value.slice(lastBrace + 1);
  while (suffix.length > 0 && isJSONWhitespaceChar(suffix[0]!)) suffix = suffix.slice(1);
  if (suffix === "" || `"playgame":`.startsWith(suffix)) {
    return value.length - lastBrace;
  }
  return suffixMarkerPrefixLength(value, PLAYGAME_MARKER);
}

function isJSONStructural(ch: string): boolean {
  return ch === ":" || ch === "," || ch === "}" || ch === "]";
}

function isValidJSONEscape(ch: string): boolean {
  return (
    ch === `"` || ch === "\\" || ch === "/" || ch === "b" ||
    ch === "f" || ch === "n" || ch === "r" || ch === "t" || ch === "u"
  );
}

function nextNonJSONWhitespace(value: string, start: number): number {
  for (let i = start; i < value.length; i++) {
    if (!isJSONWhitespaceChar(value[i]!)) return i;
  }
  return -1;
}

function extractPlaygameCandidate(text: string): { candidate: string; consumed: number; complete: boolean } {
  if (text === "" || text[0] !== "{") return { candidate: "", consumed: 0, complete: false };
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = 0; index < text.length; index++) {
    const ch = text[index]!;
    if (inString) {
      if (ch === "\\") {
        escaped = !escaped ? true : false;
        if (escaped) continue;
        continue;
      }
      if (ch === `"` && !escaped) {
        const next = nextNonJSONWhitespace(text, index + 1);
        if (next < 0 || isJSONStructural(text[next]!)) inString = false;
      }
      escaped = false;
      continue;
    }
    if (ch === `"`) {
      inString = true;
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return { candidate: text.slice(0, index + 1), consumed: index + 1, complete: true };
    }
  }
  return { candidate: text, consumed: 0, complete: false };
}

function repairPlaygameJSON(text: string): string {
  let out = "";
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (!inString) {
      out += ch;
      if (ch === `"`) inString = true;
      continue;
    }
    if (ch === "\\") {
      const next = text[i + 1];
      if (next !== undefined && isValidJSONEscape(next)) {
        out += ch + next;
        i++;
      } else {
        out += `\\\\`;
      }
      continue;
    }
    if (ch === `"`) {
      const next = nextNonJSONWhitespace(text, i + 1);
      if (next < 0 || isJSONStructural(text[next]!)) {
        out += ch;
        inString = false;
      } else {
        out += `\\"`;
      }
      continue;
    }
    out += ch;
  }
  return out;
}

function skipPlaygameSeparators(value: string): string {
  let i = 0;
  while (i < value.length) {
    const ch = value[i]!;
    if (ch === " " || ch === "\n" || ch === "\t" || ch === "\r" || ch === "}") i++;
    else break;
  }
  return value.slice(i);
}

interface Decoded {
  status: "complete" | "incomplete" | "invalid";
  consumed: number;
  call?: ToolCall;
}

function toCall(action: string, argsRaw: string): ToolCall {
  let args = argsRaw;
  if (args === "" || args === "null") args = "{}";
  return { id: "", type: "function", function: { name: action, arguments: args } };
}

function parseEnvelope(text: string): { action: string; argsRaw: string } | null {
  try {
    const envelope = JSON.parse(text) as { playgame?: { action?: unknown; args?: unknown } };
    const action = envelope?.playgame?.action;
    if (typeof action !== "string" || action === "") return null;
    const args = (envelope?.playgame as { args?: unknown })?.args;
    const argsRaw = args === undefined || args === null ? "{}" : typeof args === "string" ? args : JSON.stringify(args);
    return { action, argsRaw: argsRaw === "" || argsRaw === "null" ? "{}" : argsRaw };
  } catch {
    return null;
  }
}

// Find the end (exclusive) of the leading JSON value, mirroring Go
// json.Decoder.InputOffset for the strict first attempt.
function jsonValueEnd(value: string, start: number): number {
  let index = start;
  while (index < value.length && isJSONWhitespaceChar(value[index]!)) index++;
  if (index >= value.length) return -1;
  const first = value[index]!;
  if (first === `"`) {
    index++;
    let escaped = false;
    for (; index < value.length; index++) {
      const ch = value[index]!;
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === `"`) return index + 1;
    }
    return -1;
  }
  if (first === "{" || first === "[") {
    const stack: string[] = [first === "{" ? "}" : "]"];
    let quoted = false;
    let escaped = false;
    for (index++; index < value.length; index++) {
      const ch = value[index]!;
      if (quoted) {
        if (escaped) escaped = false;
        else if (ch === "\\") escaped = true;
        else if (ch === `"`) quoted = false;
        continue;
      }
      if (ch === `"`) {
        quoted = true;
        continue;
      }
      if (ch === "{" || ch === "[") stack.push(ch === "{" ? "}" : "]");
      else if (ch === stack[stack.length - 1]) {
        stack.pop();
        if (stack.length === 0) return index + 1;
      } else if (ch === "}" || ch === "]") return -1;
    }
    return -1;
  }
  index++;
  while (index < value.length && !/[\s,}\]]/.test(value[index]!)) index++;
  return index > start ? index : -1;
}

function decodePlaygame(text: string, final: boolean): Decoded {
  const end = jsonValueEnd(text, 0);
  if (end >= 0) {
    const parsed = parseEnvelope(text.slice(0, end));
    if (parsed) return { status: "complete", consumed: end, call: toCall(parsed.action, parsed.argsRaw) };
    // Valid JSON value but no action: check whether it is even a playgame
    // envelope; otherwise fall through to candidate/repair handling below so
    // Windows-command JSON still recovers (Go decodePlaygame repair path).
    try {
      const raw = JSON.parse(text.slice(0, end) || "null") as { playgame?: unknown };
      if (raw !== null && typeof raw === "object" && "playgame" in (raw as Record<string, unknown>)) {
        return { status: "invalid", consumed: 0 };
      }
    } catch {
      // fall through to repair path
    }
  }
  const candidate = extractPlaygameCandidate(text);
  if (candidate.complete) {
    const repaired = repairPlaygameJSON(candidate.candidate);
    const parsed = parseEnvelope(repaired);
    if (parsed) return { status: "complete", consumed: candidate.consumed, call: toCall(parsed.action, parsed.argsRaw) };
  } else if (final) {
    const repaired = repairPlaygameJSON(text);
    const parsed = parseEnvelope(repaired);
    if (parsed) return { status: "complete", consumed: text.length, call: toCall(parsed.action, parsed.argsRaw) };
    return { status: "incomplete", consumed: 0 };
  } else {
    return { status: "incomplete", consumed: 0 };
  }
  return { status: "invalid", consumed: 0 };
}

export class ToolSimulationStream {
  private pending = "";
  private nextCall = 0;

  push(text: string): ToolSimulationPart[] {
    if (text === "") return [];
    this.pending += text;
    return this.drain(false);
  }

  flush(): ToolSimulationPart[] {
    const parts = this.drain(true);
    if (this.pending !== "") {
      parts.push({ text: this.pending });
      this.pending = "";
    }
    return parts;
  }

  private drain(final: boolean): ToolSimulationPart[] {
    const parts: ToolSimulationPart[] = [];
    while (this.pending !== "") {
      const markerIndex = findPlaygameMarker(this.pending);
      if (markerIndex < 0) {
        if (final) {
          parts.push({ text: this.pending });
          this.pending = "";
          break;
        }
        const keep = suffixPlaygamePrefixLength(this.pending);
        if (keep === this.pending.length) break;
        if (keep > 0) {
          parts.push({ text: this.pending.slice(0, this.pending.length - keep) });
          this.pending = this.pending.slice(this.pending.length - keep);
        } else {
          parts.push({ text: this.pending });
          this.pending = "";
        }
        break;
      }
      if (markerIndex > 0) {
        parts.push({ text: this.pending.slice(0, markerIndex) });
        this.pending = this.pending.slice(markerIndex);
        continue;
      }
      const decoded = decodePlaygame(this.pending, final);
      if (decoded.status === "incomplete") {
        if (this.pending.length > MAX_PLAYGAME_PENDING) {
          parts.push({ text: this.pending });
          this.pending = "";
        }
        return parts;
      }
      if (decoded.status === "invalid") {
        parts.push({ text: this.pending.slice(0, 1) });
        this.pending = this.pending.slice(1);
        continue;
      }
      const call = decoded.call!;
      this.nextCall++;
      call.id = `call_playgame_${this.nextCall}`;
      parts.push({ toolCall: call });
      this.pending = skipPlaygameSeparators(this.pending.slice(decoded.consumed));
    }
    return parts;
  }
}

/** Normalize upstream native tool-invocation names (handlers.go:606 nativeToolCall). */
export function nativeToolCall(event: {
  toolName?: string;
  toolCallId?: string;
  toolArguments?: string;
}): ToolCall | null {
  if (!event.toolName || !event.toolArguments) return null;
  let name = event.toolName.trim();
  switch (name.toLowerCase()) {
    case "websearch":
    case "web-search":
    case "web_search":
      name = "web_search";
      break;
  }
  return {
    id: event.toolCallId ?? "",
    type: "function",
    function: { name, arguments: event.toolArguments },
  };
}

/**
 * Parse one or more playgame tool simulations from complete text (e.g. non-streaming mode).
 * Matches Go ParseToolSimulations (request.go:979-1019).
 */
export function parseToolSimulations(text: string): { text: string; calls: ToolCall[] } {
  const parser = new ToolSimulationStream();
  const parts = [...parser.push(text), ...parser.flush()];
  const calls: ToolCall[] = [];
  let plain = "";
  for (const part of parts) {
    if (part.toolCall) {
      calls.push(part.toolCall);
    } else if (part.text) {
      plain += part.text;
    }
  }
  return { text: plain.trim(), calls };
}

/**
 * Parse a single tool simulation from complete text (Go ParseToolSimulation).
 */
export function parseToolSimulation(text: string): { text: string; call: ToolCall | null } {
  const { text: cleaned, calls } = parseToolSimulations(text);
  return { text: cleaned, call: calls.length > 0 ? calls[0]! : null };
}
