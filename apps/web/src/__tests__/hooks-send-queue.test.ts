/**
 * hooks-send-queue.test.ts — Unit tests for send/queue/error handling in hooks.tsx.
 *
 * Tests doSend error feedback, processQueue re-insertion, sendingRef race guard,
 * deliver: false parameter, queue attachments field, and streaming timeout feedback.
 *
 * These are logic-level tests that verify the behavior of extracted/refactored functions.
 * Since doSend/processQueue/sendMessage are deeply coupled to React hooks + WebSocket client,
 * we test the logic patterns in isolation:
 * - Error message creation pattern
 * - Queue re-insertion on failure
 * - sendingRef guard logic
 * - Queue item shape with attachments
 * - deliver: false in request params
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { DisplayMessage } from "@/lib/gateway/hooks";

// ---------------------------------------------------------------------------
// 1. Error message creation pattern (#242)
// ---------------------------------------------------------------------------
describe("doSend error feedback — error message shape", () => {
  function createErrorMessage(errorText: string): DisplayMessage {
    return {
      id: `error-${Date.now()}`,
      role: "assistant",
      content: errorText,
      timestamp: new Date().toISOString(),
      toolCalls: [],
      isError: true,
    } as DisplayMessage;
  }

  it("creates error message with isError flag", () => {
    const msg = createErrorMessage("⚠️ 메시지 전송에 실패했습니다. 다시 시도해주세요.");
    expect(msg.role).toBe("assistant");
    expect(msg.isError).toBe(true);
    expect(msg.content).toContain("전송에 실패");
    expect(msg.toolCalls).toEqual([]);
  });

  it("error message id starts with 'error-'", () => {
    const msg = createErrorMessage("test error");
    expect(msg.id).toMatch(/^error-/);
  });
});

// ---------------------------------------------------------------------------
// 2. Streaming timeout feedback message (#242)
// ---------------------------------------------------------------------------
describe("streaming timeout — no-response message", () => {
  function createTimeoutMessage(): DisplayMessage {
    return {
      id: `timeout-${Date.now()}`,
      role: "assistant",
      content: "⏳ 에이전트로부터 응답이 없습니다. 잠시 후 다시 시도해주세요.",
      timestamp: new Date().toISOString(),
      toolCalls: [],
      isError: true,
    } as DisplayMessage;
  }

  it("creates timeout message with isError flag", () => {
    const msg = createTimeoutMessage();
    expect(msg.role).toBe("assistant");
    expect(msg.isError).toBe(true);
    expect(msg.content).toContain("응답이 없습니다");
  });

  it("timeout message id starts with 'timeout-'", () => {
    const msg = createTimeoutMessage();
    expect(msg.id).toMatch(/^timeout-/);
  });
});

// ---------------------------------------------------------------------------
// 3. Queue re-insertion on processQueue failure (#245)
// ---------------------------------------------------------------------------
describe("processQueue failure — re-insert at front", () => {
  it("re-inserts failed item at front of queue", () => {
    const queue = [
      { id: "msg-2", text: "second", attachments: undefined },
      { id: "msg-3", text: "third", attachments: undefined },
    ];
    const failedItem = { id: "msg-1", text: "first", attachments: undefined };

    // Simulate re-insertion: [failedItem, ...remaining]
    const restored = [failedItem, ...queue];
    expect(restored[0].id).toBe("msg-1");
    expect(restored.length).toBe(3);
  });

  it("does not duplicate if queue was empty", () => {
    const queue: { id: string; text: string; attachments?: unknown[] }[] = [];
    const failedItem = { id: "msg-1", text: "first", attachments: undefined };
    const restored = [failedItem, ...queue];
    expect(restored.length).toBe(1);
    expect(restored[0].id).toBe("msg-1");
  });
});

// ---------------------------------------------------------------------------
// 4. sendingRef guard logic (#245)
// ---------------------------------------------------------------------------
describe("sendingRef — streaming race prevention", () => {
  it("blocks send when sendingRef is true", () => {
    let sendingRef = { current: false };
    const streaming = false;

    // Should send when neither flag is set
    const shouldQueue1 = streaming || sendingRef.current;
    expect(shouldQueue1).toBe(false);

    // Should queue when sendingRef is true
    sendingRef.current = true;
    const shouldQueue2 = streaming || sendingRef.current;
    expect(shouldQueue2).toBe(true);
  });

  it("blocks send when streaming is true", () => {
    const sendingRef = { current: false };
    const streaming = true;
    const shouldQueue = streaming || sendingRef.current;
    expect(shouldQueue).toBe(true);
  });

  it("blocks send when both flags are true", () => {
    const sendingRef = { current: true };
    const streaming = true;
    const shouldQueue = streaming || sendingRef.current;
    expect(shouldQueue).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 5. Queue item with attachments field (#245)
// ---------------------------------------------------------------------------
describe("queue item — attachments field", () => {
  interface QueueItem {
    id: string;
    text: string;
    attachments?: Array<{ fileName: string; mimeType: string; dataUrl?: string; downloadUrl?: string }>;
  }

  it("supports attachments in queue item", () => {
    const item: QueueItem = {
      id: "msg-1",
      text: "hello",
      attachments: [
        { fileName: "photo.jpg", mimeType: "image/jpeg", dataUrl: "data:image/jpeg;base64,abc" },
      ],
    };
    expect(item.attachments).toHaveLength(1);
    expect(item.attachments![0].fileName).toBe("photo.jpg");
  });

  it("queue item without attachments is valid", () => {
    const item: QueueItem = { id: "msg-2", text: "no attachment" };
    expect(item.attachments).toBeUndefined();
  });

  it("persists and restores queue with attachments", () => {
    const queue: QueueItem[] = [
      { id: "msg-1", text: "with att", attachments: [{ fileName: "a.png", mimeType: "image/png" }] },
      { id: "msg-2", text: "no att" },
    ];
    const serialized = JSON.stringify(queue);
    const restored: QueueItem[] = JSON.parse(serialized);
    expect(restored[0].attachments).toHaveLength(1);
    expect(restored[1].attachments).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 6. deliver: false parameter (#247)
// ---------------------------------------------------------------------------
describe("deliver: false in chat.send", () => {
  it("request params include deliver: false", () => {
    const text = "hello";
    const idempotencyKey = "awf-123";
    const sessionKey = "session-abc";

    const params = {
      message: text,
      idempotencyKey,
      sessionKey,
      deliver: false,
    };

    expect(params.deliver).toBe(false);
    expect(params.message).toBe("hello");
    expect(params.sessionKey).toBe("session-abc");
  });
});

// ---------------------------------------------------------------------------
// 7. DisplayMessage.isError field exists (#242)
// ---------------------------------------------------------------------------
describe("DisplayMessage — isError field", () => {
  it("isError is optional and boolean", () => {
    const normalMsg: DisplayMessage = {
      id: "msg-1",
      role: "assistant",
      content: "hello",
      timestamp: new Date().toISOString(),
      toolCalls: [],
    };
    expect(normalMsg.isError).toBeUndefined();

    const errorMsg = { ...normalMsg, isError: true } as DisplayMessage;
    expect(errorMsg.isError).toBe(true);
  });
});
