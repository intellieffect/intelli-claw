/**
 * issue-290-thinking-hang.test.ts
 *
 * #290: "AI 생각 중 멈춤 → 재입력 시 밀려서 응답되는 현상"
 *
 * When the AI's thinking phase hangs for more than THINKING_TIMEOUT_MS,
 * any messages the user queued during the hang must be able to drain as
 * soon as the timeout fires — the `streaming` state must reset to false
 * so `processQueue` is unblocked, and subsequent streams must still get a
 * fresh thinking timeout (the cleanup must not permanently poison the
 * streaming lifecycle).
 *
 * `useChat` / `processQueue` / `ChatStreamProcessor` are deeply coupled to
 * React state + refs + the gateway client, so (following the pattern in
 * hooks-send-queue.test.ts and issue-266-no-response-feedback.test.ts) we
 * test the extracted pure helper — `handleThinkingTimeout` — in isolation,
 * plus a fake-timer simulation of the queue poll loop to pin the behavior.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  THINKING_TIMEOUT_MS,
  PROCESS_QUEUE_TIMEOUT_MS,
  handleThinkingTimeout,
  type DisplayMessage,
  type AgentStatus,
} from "@/lib/gateway/hooks";

// ---------------------------------------------------------------------------
// 1. THINKING_TIMEOUT_MS contract
// ---------------------------------------------------------------------------
describe("THINKING_TIMEOUT_MS (#290)", () => {
  it("is exactly 45 seconds", () => {
    expect(THINKING_TIMEOUT_MS).toBe(45_000);
  });

  it("is strictly less than the queue poll cap so the queue never outruns the thinking timeout", () => {
    // The queue-level safety net (#266) must be longer than the thinking
    // timeout, otherwise the queue bails before the thinking timeout can
    // unblock it.
    expect(THINKING_TIMEOUT_MS).toBeLessThan(PROCESS_QUEUE_TIMEOUT_MS);
  });
});

// ---------------------------------------------------------------------------
// 2. handleThinkingTimeout — pure helper under test
// ---------------------------------------------------------------------------
describe("handleThinkingTimeout (#290)", () => {
  // Shape of the refs/setters the helper operates on. Mirrors what the
  // useChat hook passes at the call site.
  function makeFakeEnv() {
    const streamingRef = { current: true };
    let messages: DisplayMessage[] = [];
    const setMessages = vi.fn(
      (updater: DisplayMessage[] | ((prev: DisplayMessage[]) => DisplayMessage[])) => {
        messages = typeof updater === "function" ? updater(messages) : updater;
      },
    );
    const setStreaming = vi.fn((val: boolean) => {
      streamingRef.current = val;
    });
    const setAgentStatus = vi.fn<(s: AgentStatus) => void>();
    return {
      streamingRef,
      setMessages,
      setStreaming,
      setAgentStatus,
      getMessages: () => messages,
    };
  }

  it("clears streamingRef.current so processQueue's wait loop can proceed", () => {
    const env = makeFakeEnv();
    expect(env.streamingRef.current).toBe(true);

    handleThinkingTimeout({
      streamingRef: env.streamingRef,
      setMessages: env.setMessages,
      setStreaming: env.setStreaming,
      setAgentStatus: env.setAgentStatus,
    });

    expect(env.streamingRef.current).toBe(false);
  });

  it("also calls setStreaming(false) so the useEffect-driven processQueue trigger fires", () => {
    const env = makeFakeEnv();

    handleThinkingTimeout({
      streamingRef: env.streamingRef,
      setMessages: env.setMessages,
      setStreaming: env.setStreaming,
      setAgentStatus: env.setAgentStatus,
    });

    expect(env.setStreaming).toHaveBeenCalledWith(false);
  });

  it("resets agent status to idle", () => {
    const env = makeFakeEnv();

    handleThinkingTimeout({
      streamingRef: env.streamingRef,
      setMessages: env.setMessages,
      setStreaming: env.setStreaming,
      setAgentStatus: env.setAgentStatus,
    });

    expect(env.setAgentStatus).toHaveBeenCalledWith({ phase: "idle" });
  });

  it("appends a system-role timeout message with isError so chat-panel renders it as a banner", () => {
    const env = makeFakeEnv();

    handleThinkingTimeout({
      streamingRef: env.streamingRef,
      setMessages: env.setMessages,
      setStreaming: env.setStreaming,
      setAgentStatus: env.setAgentStatus,
    });

    const msgs = env.getMessages();
    expect(msgs).toHaveLength(1);
    const [msg] = msgs;
    expect(msg.role).toBe("system");
    expect(msg.isError).toBe(true);
    expect(msg.toolCalls).toEqual([]);
    expect(msg.content).toContain("생각");
    expect(msg.id).toMatch(/^thinking-timeout-/);
  });

  it("is idempotent — calling it a second time is safe (already-cleared refs)", () => {
    const env = makeFakeEnv();

    handleThinkingTimeout({
      streamingRef: env.streamingRef,
      setMessages: env.setMessages,
      setStreaming: env.setStreaming,
      setAgentStatus: env.setAgentStatus,
    });
    // Second call with refs already cleared should not throw and should
    // still produce a (second) system notice without corrupting state.
    expect(() =>
      handleThinkingTimeout({
        streamingRef: env.streamingRef,
        setMessages: env.setMessages,
        setStreaming: env.setStreaming,
        setAgentStatus: env.setAgentStatus,
      }),
    ).not.toThrow();
    expect(env.streamingRef.current).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3. Queue-drains-after-thinking-timeout — fake-timer simulation
// ---------------------------------------------------------------------------
describe("thinking timeout unblocks queued messages (#290)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * Mirror of processQueue's poll loop — resolves cleanly when streaming
   * ends OR when PROCESS_QUEUE_TIMEOUT_MS elapses. Returns which branch
   * fired so tests can pin behavior.
   */
  function waitForStreamingEnd(streamingRef: { current: boolean }): Promise<
    "streaming-ended" | "queue-bailout"
  > {
    return new Promise((resolve) => {
      const start = Date.now();
      const check = () => {
        setTimeout(() => {
          if (!streamingRef.current) {
            resolve("streaming-ended");
            return;
          }
          if (Date.now() - start > PROCESS_QUEUE_TIMEOUT_MS) {
            resolve("queue-bailout");
            return;
          }
          check();
        }, 300);
      };
      check();
    });
  }

  it("scenario 1: thinking phase exceeds THINKING_TIMEOUT_MS → queue resumes on helper call", async () => {
    // Streaming is active because doSend just kicked off a message.
    const streamingRef = { current: true };
    let messages: DisplayMessage[] = [];
    const setMessages = (
      u: DisplayMessage[] | ((p: DisplayMessage[]) => DisplayMessage[]),
    ) => {
      messages = typeof u === "function" ? u(messages) : u;
    };
    const setStreaming = (v: boolean) => {
      streamingRef.current = v;
    };
    const setAgentStatus = vi.fn();

    const startWall = Date.now();

    // processQueue enters its wait loop, polling every 300ms.
    const waitPromise = waitForStreamingEnd(streamingRef);

    // Arm the thinking safety timer the way hooks.tsx does — it should
    // fire at THINKING_TIMEOUT_MS and drive `handleThinkingTimeout`.
    setTimeout(() => {
      handleThinkingTimeout({
        streamingRef,
        setMessages,
        setStreaming,
        setAgentStatus,
      });
    }, THINKING_TIMEOUT_MS);

    // Advance past the thinking timeout + one poll tick so the wait loop
    // observes the cleared state.
    await vi.advanceTimersByTimeAsync(THINKING_TIMEOUT_MS + 400);

    expect(await waitPromise).toBe("streaming-ended");
    // Queue must see the cleared ref *before* the 60s queue bailout fires.
    const elapsed = Date.now() - startWall;
    expect(elapsed).toBeLessThan(PROCESS_QUEUE_TIMEOUT_MS);
    // User got a visible notice that the thinking phase gave up.
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe("system");
    expect(messages[0].isError).toBe(true);
  });

  it("scenario 2: after timeout fires, streaming state is reset to false so the next queue iteration can dispatch", () => {
    const streamingRef = { current: true };
    let messages: DisplayMessage[] = [];
    const setMessages = (
      u: DisplayMessage[] | ((p: DisplayMessage[]) => DisplayMessage[])
    ) => { messages = typeof u === "function" ? u(messages) : u; };
    const setStreaming = vi.fn((v: boolean) => { streamingRef.current = v; });
    const setAgentStatus = vi.fn();

    handleThinkingTimeout({
      streamingRef,
      setMessages,
      setStreaming,
      setAgentStatus,
    });

    // After the helper runs, both the ref (sync path) and the setter
    // (React-state path) must reflect streaming=false. Either path alone
    // is insufficient: processQueue polls the ref; the useEffect watcher
    // polls the React state.
    expect(streamingRef.current).toBe(false);
    expect(setStreaming).toHaveBeenCalledWith(false);
    expect(setAgentStatus).toHaveBeenCalledWith({ phase: "idle" });
  });

  it("scenario 3: a fresh stream after timeout gets its own independent thinking timeout", async () => {
    // First stream — hangs and times out.
    const streamingRef = { current: true };
    let messages: DisplayMessage[] = [];
    const setMessages = (
      u: DisplayMessage[] | ((p: DisplayMessage[]) => DisplayMessage[]),
    ) => { messages = typeof u === "function" ? u(messages) : u; };
    const setStreaming = (v: boolean) => { streamingRef.current = v; };
    const setAgentStatus = vi.fn();

    setTimeout(() => {
      handleThinkingTimeout({
        streamingRef,
        setMessages,
        setStreaming,
        setAgentStatus,
      });
    }, THINKING_TIMEOUT_MS);

    await vi.advanceTimersByTimeAsync(THINKING_TIMEOUT_MS + 10);
    expect(streamingRef.current).toBe(false);

    // Second stream starts (e.g., queued message dispatched). The hook
    // re-arms a fresh thinking timer for this new stream.
    streamingRef.current = true;
    let secondTimeoutFired = false;
    setTimeout(() => {
      secondTimeoutFired = true;
      handleThinkingTimeout({
        streamingRef,
        setMessages,
        setStreaming,
        setAgentStatus,
      });
    }, THINKING_TIMEOUT_MS);

    // Just before the second thinking timeout — second stream should
    // still be active. The first timer must NOT re-fire.
    await vi.advanceTimersByTimeAsync(THINKING_TIMEOUT_MS - 100);
    expect(secondTimeoutFired).toBe(false);
    expect(streamingRef.current).toBe(true);

    // At the full second timeout — second stream cleans up independently.
    await vi.advanceTimersByTimeAsync(200);
    expect(secondTimeoutFired).toBe(true);
    expect(streamingRef.current).toBe(false);
    // Two system notices now exist — one per timed-out stream.
    expect(messages.length).toBe(2);
    expect(messages.every((m) => m.role === "system" && m.isError === true)).toBe(true);
  });
});
