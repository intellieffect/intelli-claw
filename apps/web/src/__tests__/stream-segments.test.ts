/**
 * stream-segments.test.ts — Tests for #231 buildStreamSegments()
 *
 * Verifies that text↔tool interleave order is preserved when building
 * MessageSegment[] from the 3-buffer streaming state.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { createRef } from "react";
import {
  buildStreamSegments,
  resetAllStreamRefs,
  commitChatStreamToSegment,
  type ToolStreamRefs,
  type ToolStreamEntry,
} from "@/lib/gateway/tool-stream";

function createRefs(): ToolStreamRefs {
  return {
    chatStream: createRef() as any,
    chatStreamId: createRef() as any,
    chatStreamStartedAt: createRef() as any,
    chatStreamSegments: createRef() as any,
    toolStreamById: createRef() as any,
    toolStreamOrder: createRef() as any,
  };
}

function initRefs(refs: ToolStreamRefs) {
  refs.chatStream.current = null;
  refs.chatStreamId.current = null;
  refs.chatStreamStartedAt.current = null;
  refs.chatStreamSegments.current = [];
  refs.toolStreamById.current = new Map();
  refs.toolStreamOrder.current = [];
}

describe("buildStreamSegments (#231)", () => {
  let refs: ToolStreamRefs;

  beforeEach(() => {
    refs = createRefs();
    initRefs(refs);
  });

  it("returns empty array when no streaming state", () => {
    expect(buildStreamSegments(refs)).toEqual([]);
  });

  it("returns single text segment for text-only stream", () => {
    refs.chatStream.current = "Hello world";
    const segments = buildStreamSegments(refs);
    expect(segments).toEqual([{ type: "text", text: "Hello world" }]);
  });

  it("preserves text → tool → text interleave order", () => {
    // Simulate: "Analyzing..." → tool:read_file → "Found the issue."
    const baseTs = 1000;

    // Text A committed before tool
    refs.chatStreamSegments.current = [
      { text: "Analyzing the code...", ts: baseTs },
    ];

    // Tool call started after text A
    const toolEntry: ToolStreamEntry = {
      toolCallId: "call-1",
      name: "read_file",
      args: '{"path":"src/app.ts"}',
      output: "file contents...",
      startedAt: baseTs + 100,
      updatedAt: baseTs + 200,
    };
    refs.toolStreamById.current.set("call-1", toolEntry);
    refs.toolStreamOrder.current = ["call-1"];

    // Text B is current (uncommitted) chatStream
    refs.chatStream.current = "Found the issue.";

    const segments = buildStreamSegments(refs);
    expect(segments).toHaveLength(3);
    expect(segments[0]).toEqual({ type: "text", text: "Analyzing the code..." });
    expect(segments[1].type).toBe("tool");
    expect((segments[1] as any).toolCall.name).toBe("read_file");
    expect(segments[2]).toEqual({ type: "text", text: "Found the issue." });
  });

  it("preserves text → tool1 → text → tool2 → text order", () => {
    const baseTs = 1000;

    refs.chatStreamSegments.current = [
      { text: "Step 1", ts: baseTs },
      { text: "Step 2", ts: baseTs + 300 },
    ];

    const tool1: ToolStreamEntry = {
      toolCallId: "c1", name: "search", startedAt: baseTs + 100, updatedAt: baseTs + 200,
    };
    const tool2: ToolStreamEntry = {
      toolCallId: "c2", name: "edit", startedAt: baseTs + 400, updatedAt: baseTs + 500,
    };
    refs.toolStreamById.current.set("c1", tool1);
    refs.toolStreamById.current.set("c2", tool2);
    refs.toolStreamOrder.current = ["c1", "c2"];

    refs.chatStream.current = "All done.";

    const segments = buildStreamSegments(refs);
    expect(segments).toHaveLength(5);
    expect(segments[0]).toEqual({ type: "text", text: "Step 1" });
    expect(segments[1].type).toBe("tool");
    expect((segments[1] as any).toolCall.name).toBe("search");
    expect(segments[2]).toEqual({ type: "text", text: "Step 2" });
    expect(segments[3].type).toBe("tool");
    expect((segments[3] as any).toolCall.name).toBe("edit");
    expect(segments[4]).toEqual({ type: "text", text: "All done." });
  });

  it("handles tool-only response (no text)", () => {
    const tool: ToolStreamEntry = {
      toolCallId: "c1", name: "exec", startedAt: 1000, updatedAt: 1100,
    };
    refs.toolStreamById.current.set("c1", tool);
    refs.toolStreamOrder.current = ["c1"];

    const segments = buildStreamSegments(refs);
    expect(segments).toHaveLength(1);
    expect(segments[0].type).toBe("tool");
  });

  it("filters empty/whitespace text segments", () => {
    refs.chatStreamSegments.current = [
      { text: "  ", ts: 1000 },
      { text: "Valid text", ts: 2000 },
    ];
    refs.chatStream.current = "   ";

    const segments = buildStreamSegments(refs);
    expect(segments).toHaveLength(1);
    expect(segments[0]).toEqual({ type: "text", text: "Valid text" });
  });

  it("handles consecutive tools without text between them", () => {
    const tool1: ToolStreamEntry = {
      toolCallId: "c1", name: "read", startedAt: 1000, updatedAt: 1100,
    };
    const tool2: ToolStreamEntry = {
      toolCallId: "c2", name: "write", startedAt: 1200, updatedAt: 1300,
    };
    refs.toolStreamById.current.set("c1", tool1);
    refs.toolStreamById.current.set("c2", tool2);
    refs.toolStreamOrder.current = ["c1", "c2"];

    const segments = buildStreamSegments(refs);
    expect(segments).toHaveLength(2);
    expect(segments[0].type).toBe("tool");
    expect(segments[1].type).toBe("tool");
  });

  it("marks running tools correctly", () => {
    const tool: ToolStreamEntry = {
      toolCallId: "c1", name: "exec", startedAt: 1000, updatedAt: 1000,
      // no output = running
    };
    refs.toolStreamById.current.set("c1", tool);
    refs.toolStreamOrder.current = ["c1"];

    const segments = buildStreamSegments(refs);
    expect((segments[0] as any).toolCall.status).toBe("running");
  });

  it("integrates with commitChatStreamToSegment", () => {
    // Simulate streaming: text arrives, then tool starts
    refs.chatStream.current = "Let me check...";
    refs.chatStreamStartedAt.current = 1000;
    refs.chatStreamId.current = "stream-1";

    // Commit before tool start
    commitChatStreamToSegment(refs);

    // Fix the committed segment's timestamp to be before the tool
    refs.chatStreamSegments.current[0].ts = 1000;

    // Now add tool
    const tool: ToolStreamEntry = {
      toolCallId: "c1", name: "read_file", startedAt: 1100, updatedAt: 1200,
      output: "contents",
    };
    refs.toolStreamById.current.set("c1", tool);
    refs.toolStreamOrder.current = ["c1"];

    // New text after tool
    refs.chatStream.current = "Here's what I found.";

    const segments = buildStreamSegments(refs);
    expect(segments).toHaveLength(3);
    expect(segments[0]).toEqual({ type: "text", text: "Let me check..." });
    expect(segments[1].type).toBe("tool");
    expect(segments[2]).toEqual({ type: "text", text: "Here's what I found." });
  });
});
