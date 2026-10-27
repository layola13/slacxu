import { describe, expect, test } from "bun:test";
import {
  CodexStreamRetryTracker,
  isBenignCodexStderr,
  parseCodexStderrLine,
} from "../../apps/server/src/codexStreamRetryMonitor";

const RETRY_LINE =
  "[codex] 2026-09-16T04:38:02.194434Z  WARN codex_core::responses_retry: stream connection failed; waiting to retry turn_id=01a0a877-d67d-7a02-bdad-39461db0807b error=Connection failed: error sending request retry_delay=60s";

describe("codexStreamRetryMonitor", () => {
  test("parses stream retry stderr with turn id, error and delay", () => {
    const parsed = parseCodexStderrLine(RETRY_LINE);
    expect(parsed.kind).toBe("stream-retry");
    if (parsed.kind !== "stream-retry") return;
    expect(parsed.turnId).toBe("01a0a877-d67d-7a02-bdad-39461db0807b");
    expect(parsed.errorText).toContain("Connection failed");
    expect(parsed.retryDelayText).toBe("60s");
  });

  test("parses graceful timeout and ignores benign noise", () => {
    expect(
      parseCodexStderrLine(
        "[codex] 2026-09-16T04:53:38.942270Z  WARN codex_core::tasks: task 01a0a877-d67d-7a02-bdad-39461db0807b didn't complete gracefully after 100ms",
      ).kind,
    ).toBe("graceful-timeout");
    expect(parseCodexStderrLine("th is not supported").kind).toBe("ignored");
    expect(
      isBenignCodexStderr(
        "[codex] WARN codex_skills::interface: ignoring interface.icon_small: icon path with '..' must resolve under plugin assets/",
      ),
    ).toBe(true);
    expect(
      isBenignCodexStderr(
        "[codex] WARN codex_core::shell_snapshot: Failed to create shell snapshot for powershell: Shell snapshot not supported yet for PowerShell",
      ),
    ).toBe(true);
    expect(isBenignCodexStderr(RETRY_LINE)).toBe(false);
  });

  test("tracker stays quiet on first retry, notifies on storm and stalls", () => {
    const tracker = new CodexStreamRetryTracker();
    const first = tracker.ingest(RETRY_LINE, 1_000);
    expect(first).toBeNull();
    const second = tracker.ingest(RETRY_LINE, 61_000);
    expect(second?.attempt).toBe(2);
    expect(second?.stalled).toBe(false);
    const third = tracker.ingest(RETRY_LINE, 121_000);
    expect(third?.attempt).toBe(3);
    expect(third?.stalled).toBe(true);
    expect(third?.message).toMatch(/Interrupt/);
    const fourth = tracker.ingest(RETRY_LINE, 181_000);
    expect(fourth).toBeNull();
    expect(tracker.attemptCount("01a0a877-d67d-7a02-bdad-39461db0807b")).toBe(4);
  });

  test("terminal task resolves the tracked turn and resets after turn terminal", () => {
    const tracker = new CodexStreamRetryTracker();
    tracker.ingest(RETRY_LINE, 1_000);
    tracker.ingest(RETRY_LINE, 2_000);
    const terminal = tracker.terminalTask("01a0a877-d67d-7a02-bdad-39461db0807b");
    expect(terminal?.turnId).toBe("01a0a877-d67d-7a02-bdad-39461db0807b");
    tracker.markTurnTerminal("01a0a877-d67d-7a02-bdad-39461db0807b");
    expect(tracker.attemptCount("01a0a877-d67d-7a02-bdad-39461db0807b")).toBe(0);
  });
});
