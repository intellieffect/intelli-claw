"use client";

import { useState, useEffect, useCallback } from "react";
import { useGateway } from "./hooks";

export interface SessionInfo {
  key: string;
  model?: string;
  thinking?: string;
  verbose?: boolean;
  label?: string;
  totalTokens?: number;
  contextTokens?: number;
  messageCount?: number;
}

export interface ModelInfo {
  id: string;
  name?: string;
  provider?: string;
}

// Module-level cache for models (rarely changes)
let _modelsCache: ModelInfo[] = [];

export function useSessionSettings(sessionKey?: string) {
  const { client, state } = useGateway();
  const isConnected = state === "connected";

  const [session, setSession] = useState<SessionInfo | null>(null);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [loading, setLoading] = useState(false);

  // Fetch current session info (Gateway v3 does not expose sessions.get)
  const fetchSession = useCallback(async () => {
    if (!client || !isConnected || !sessionKey) return;
    try {
      const res = await client.request<{ sessions: Array<Record<string, unknown>> }>(
        "sessions.list",
        { limit: 500 }
      );
      const found = (res?.sessions || []).find((s) => s.key === sessionKey);
      if (found) {
        setSession({
          key: String(found.key),
          model: found.model as string | undefined,
          thinking: found.thinking as string | undefined,
          verbose: found.verbose as boolean | undefined,
          label: found.label as string | undefined,
          totalTokens: found.totalTokens as number | undefined,
          contextTokens: found.contextTokens as number | undefined,
          messageCount: found.messageCount as number | undefined,
        });
      }
    } catch {
      // silently fail
    }
  }, [client, isConnected, sessionKey]);

  // Cache models globally — they rarely change
  const fetchModels = useCallback(async () => {
    if (!client || !isConnected) return;
    // Use cached if available
    if (_modelsCache.length > 0) {
      setModels(_modelsCache);
      return;
    }
    try {
      const res = await client.request<{ models: Array<Record<string, unknown>> }>("models.list");
      const list = (res?.models || []).map((m) => ({
        id: String(m.id || m.model || ""),
        name: (m.name || m.label || m.id || m.model) as string | undefined,
        provider: m.provider as string | undefined,
      }));
      _modelsCache = list;
      setModels(list);
    } catch {
      // silently fail
    }
  }, [client, isConnected]);

  // Fetch session on mount, models lazily
  useEffect(() => {
    fetchSession();
    fetchModels();
  }, [fetchSession, fetchModels]);

  // Patch session
  const patchSession = useCallback(
    async (patch: { model?: string; thinking?: string; verbose?: boolean; label?: string }) => {
      if (!client || !isConnected || !sessionKey) return;
      setLoading(true);
      try {
        await client.request("sessions.patch", { key: sessionKey, ...patch });
        // Optimistic update
        setSession((prev) => (prev ? { ...prev, ...patch } : prev));
      } catch (err) {
        console.error("[AWF] sessions.patch error:", err);
      } finally {
        setLoading(false);
      }
    },
    [client, isConnected, sessionKey]
  );

  // Reset session
  const resetSession = useCallback(
    async (model?: string) => {
      if (!client || !isConnected || !sessionKey) return;
      setLoading(true);
      try {
        await client.request("sessions.reset", { key: sessionKey, model });
        await fetchSession();
      } catch (err) {
        console.error("[AWF] sessions.reset error:", err);
      } finally {
        setLoading(false);
      }
    },
    [client, isConnected, sessionKey, fetchSession]
  );

  // Delete session
  const deleteSession = useCallback(async () => {
    if (!client || !isConnected || !sessionKey) return;
    setLoading(true);
    try {
      await client.request("sessions.delete", { key: sessionKey });
    } catch (err) {
      console.error("[AWF] sessions.delete error:", err);
    } finally {
      setLoading(false);
    }
  }, [client, isConnected, sessionKey]);

  return {
    session,
    models,
    loading,
    patchSession,
    resetSession,
    deleteSession,
    refresh: fetchSession,
  };
}
