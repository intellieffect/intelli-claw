import { useCallback } from "react";
import { useGateway } from "@intelli-claw/shared";
import { useChatState } from "./useChatState";
import { useChatStateManager } from "../stores/ChatStateProvider";

// ─── Re-export types for backward compatibility ───
export type { DisplayMessage, AgentStatus } from "../stores/chatStateManager";

// ─── Hook ───

export function useChat(sessionKey?: string) {
  const { messages, streaming, loading, agentStatus } =
    useChatState(sessionKey);
  const { client, state } = useGateway();
  const manager = useChatStateManager();

  // ─── Send message ───
  const sendMessage = useCallback(
    async (
      text: string,
      attachments?: Array<{
        content: string;
        data?: string;
        mimeType: string;
        fileName?: string;
      }>,
      imageUris?: string[],
    ) => {
      if (!client || state !== "connected" || !sessionKey) return;
      if (!text.trim() && (!attachments || attachments.length === 0)) return;

      // Optimistic user message
      manager.appendUserMessage(sessionKey, {
        id: `user-${Date.now()}`,
        role: "user",
        content: text.trim() || (attachments?.length ? "(이미지)" : ""),
        timestamp: new Date().toISOString(),
        toolCalls: [],
        imageUris: imageUris?.length ? imageUris : undefined,
      });

      try {
        const payload: Record<string, unknown> = {
          sessionKey,
          message: text.trim(),
          idempotencyKey: `mobile-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        };
        if (attachments && attachments.length > 0) {
          payload.attachments = attachments.map((a) => ({
            content: a.content ?? a.data,
            mimeType: a.mimeType,
            fileName: a.fileName || `image-${Date.now()}.jpg`,
          }));
        }
        await client.request("chat.send", payload);
      } catch (err) {
        console.error("[useChat] send error:", err);
      }
    },
    [client, state, sessionKey, manager],
  );

  // ─── Abort ───
  const abort = useCallback(async () => {
    if (!client || !sessionKey) return;
    try {
      const runId = manager.getRunId(sessionKey);
      await client.request("chat.abort", { sessionKey, runId });
    } catch {
      // swallow abort errors
    }
  }, [client, sessionKey, manager]);

  return {
    messages,
    streaming,
    loading,
    agentStatus,
    sendMessage,
    abort,
  };
}
