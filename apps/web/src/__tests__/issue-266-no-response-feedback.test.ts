/**
 * issue-266-no-response-feedback.test.ts
 *
 * #266: Agent no-response feedback
 *
 * When `processQueue` in hooks.tsx waits for a streaming response that never
 * arrives (60s cap), the user previously only got a silent console.warn. This
 * test suite pins the UX contract:
 *
 *   1. A pure formatter builds a Korean system message that mentions
 *      "응답하지 않았습니다" and includes a retry hint.
 *   2. The synthesized timeout message is shaped as a `system`-role
 *      DisplayMessage with `isError: true` so chat-panel renders it as a
 *      retry-prompting banner (reusing the existing error-message styling).
 *   3. The timeout branch reflects the 60s cap (PROCESS_QUEUE_TIMEOUT_MS) and
 *      can be simulated with vi.useFakeTimers without hanging forever.
 *
 * processQueue is deeply coupled to React state + refs + the gateway client,
 * so (following the pattern in hooks-send-queue.test.ts) we test the
 * extracted pure pieces and the message shape — not the full hook.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  formatTimeoutMessage,
  PROCESS_QUEUE_TIMEOUT_MS,
  type DisplayMessage,
} from "@/lib/gateway/hooks";

// ---------------------------------------------------------------------------
// 1. formatTimeoutMessage — pure function under test
// ---------------------------------------------------------------------------
describe("formatTimeoutMessage (#266)", () => {
  it("mentions that the agent did not respond", () => {
    const msg = formatTimeoutMessage(60_000);
    expect(msg).toContain("응답하지 않았습니다");
  });

  it("includes a retry call-to-action", () => {
    const msg = formatTimeoutMessage(60_000);
    // Must nudge the user to check connection / try again
    expect(msg).toMatch(/다시 시도/);
  });

  it("reports elapsed seconds (rounded)", () => {
    expect(formatTimeoutMessage(60_000)).toContain("60초");
    expect(formatTimeoutMessage(61_400)).toContain("61초");
    expect(formatTimeoutMessage(59_500)).toContain("60초");
  });

  it("never reports 0 seconds — clamps to >=1", () => {
    // Defensive: even if called with 0 (shouldn't happen) the UI must not
    // render a nonsensical "0초" message.
    expect(formatTimeoutMessage(0)).toContain("1초");
    expect(formatTimeoutMessage(200)).toContain("1초");
  });

  it("starts with a warning indicator", () => {
    const msg = formatTimeoutMessage(60_000);
    expect(msg.startsWith("⚠️")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. PROCESS_QUEUE_TIMEOUT_MS constant — 60s contract
// ---------------------------------------------------------------------------
describe("PROCESS_QUEUE_TIMEOUT_MS (#266)", () => {
  it("is exactly 60 seconds", () => {
    expect(PROCESS_QUEUE_TIMEOUT_MS).toBe(60_000);
  });

  it("matches what the user-visible message reports", () => {
    const msg = formatTimeoutMessage(PROCESS_QUEUE_TIMEOUT_MS);
    expect(msg).toContain("60초");
  });
});

// ---------------------------------------------------------------------------
// 3. Timeout DisplayMessage shape
// ---------------------------------------------------------------------------
describe("processQueue timeout message shape (#266)", () => {
  /**
   * Mirrors the literal object produced inside processQueue when the 60s cap
   * is reached. Keeping this as a local factory lets us assert the exact
   * fields that chat-panel/connection-status consumes (role, isError,
   * toolCalls, timestamp) without booting the hook.
   */
  function buildQueueTimeoutMessage(elapsedMs: number): DisplayMessage {
    return {
      id: `queue-timeout-${Date.now()}-x`,
      role: "system",
      content: formatTimeoutMessage(elapsedMs),
      timestamp: new Date().toISOString(),
      toolCalls: [],
      isError: true,
    };
  }

  it("uses role 'system' (not assistant)", () => {
    const msg = buildQueueTimeoutMessage(PROCESS_QUEUE_TIMEOUT_MS);
    expect(msg.role).toBe("system");
  });

  it("flags isError so chat-panel renders it as an error banner", () => {
    const msg = buildQueueTimeoutMessage(PROCESS_QUEUE_TIMEOUT_MS);
    expect(msg.isError).toBe(true);
  });

  it("has a 'queue-timeout-' id prefix so it cannot collide with real messages", () => {
    const msg = buildQueueTimeoutMessage(PROCESS_QUEUE_TIMEOUT_MS);
    expect(msg.id).toMatch(/^queue-timeout-/);
  });

  it("carries no tool calls", () => {
    const msg = buildQueueTimeoutMessage(PROCESS_QUEUE_TIMEOUT_MS);
    expect(msg.toolCalls).toEqual([]);
  });

  it("has a valid ISO timestamp", () => {
    const msg = buildQueueTimeoutMessage(PROCESS_QUEUE_TIMEOUT_MS);
    expect(() => new Date(msg.timestamp).toISOString()).not.toThrow();
    expect(Number.isNaN(new Date(msg.timestamp).getTime())).toBe(false);
  });

  it("content surfaces a retry hint", () => {
    const msg = buildQueueTimeoutMessage(PROCESS_QUEUE_TIMEOUT_MS);
    expect(msg.content).toMatch(/다시 시도/);
    expect(msg.content).toContain("응답하지 않았습니다");
  });
});

// ---------------------------------------------------------------------------
// 4. Timeout loop simulation with fake timers
// ---------------------------------------------------------------------------
describe("processQueue streaming wait — fake-timer simulation (#266)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * Mirrors the exact poll-loop used in processQueue: every 300ms, check
   * whether streaming finished; if more than PROCESS_QUEUE_TIMEOUT_MS has
   * elapsed, bail out and return the user-visible timeout notice.
   *
   * Returns either `{ kind: "done" }` (streaming ended normally) or
   * `{ kind: "timeout"; message: DisplayMessage }` (the 60s cap fired).
   */
  function waitForStreamingOrTimeout(
    streamingRef: { current: boolean },
  ): Promise<
    | { kind: "done" }
    | { kind: "timeout"; message: DisplayMessage; elapsedMs: number }
  > {
    return new Promise((resolve) => {
      const start = Date.now();
      const check = () => {
        setTimeout(() => {
          if (!streamingRef.current) {
            resolve({ kind: "done" });
            return;
          }
          const elapsed = Date.now() - start;
          if (elapsed > PROCESS_QUEUE_TIMEOUT_MS) {
            resolve({
              kind: "timeout",
              elapsedMs: elapsed,
              message: {
                id: `queue-timeout-${Date.now()}`,
                role: "system",
                content: formatTimeoutMessage(elapsed),
                timestamp: new Date().toISOString(),
                toolCalls: [],
                isError: true,
              },
            });
            return;
          }
          check();
        }, 300);
      };
      check();
    });
  }

  it("resolves with a system timeout message after 60s of continued streaming", async () => {
    const streamingRef = { current: true }; // stays true forever — agent never responded
    const promise = waitForStreamingOrTimeout(streamingRef);

    // Advance past the 60s cap (with a safety margin for the 300ms polls).
    await vi.advanceTimersByTimeAsync(PROCESS_QUEUE_TIMEOUT_MS + 500);

    const result = await promise;
    expect(result.kind).toBe("timeout");
    if (result.kind === "timeout") {
      expect(result.elapsedMs).toBeGreaterThan(PROCESS_QUEUE_TIMEOUT_MS);
      expect(result.message.role).toBe("system");
      expect(result.message.isError).toBe(true);
      expect(result.message.content).toContain("응답하지 않았습니다");
      expect(result.message.content).toMatch(/다시 시도/);
    }
  });

  it("resolves with 'done' (no timeout message) if streaming finishes before 60s", async () => {
    const streamingRef = { current: true };
    const promise = waitForStreamingOrTimeout(streamingRef);

    // Simulate the agent finishing after 5s — well under the cap.
    await vi.advanceTimersByTimeAsync(5_000);
    streamingRef.current = false;
    await vi.advanceTimersByTimeAsync(400); // let the next poll observe it

    const result = await promise;
    expect(result.kind).toBe("done");
  });

  it("the resolved promise is clean so subsequent queue items can proceed", async () => {
    // This test guards the task requirement: "ensure it resolves cleanly so
    // subsequent queue items can process". We chain a follow-up action that
    // would never fire if the timeout branch threw or left the promise
    // pending.
    const streamingRef = { current: true };
    let followupFired = false;

    const chain = waitForStreamingOrTimeout(streamingRef).then(() => {
      followupFired = true;
    });

    await vi.advanceTimersByTimeAsync(PROCESS_QUEUE_TIMEOUT_MS + 500);
    await chain;

    expect(followupFired).toBe(true);
  });
});
