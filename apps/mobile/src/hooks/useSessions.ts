import { useState, useEffect, useCallback, useRef } from "react";
import { useGateway, type Session } from "@intelli-claw/shared";

export function useSessions() {
  const { client, state } = useGateway();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(false);
  const lastRefreshRef = useRef(0);

  const fetchSessions = useCallback(async () => {
    if (!client || state !== "connected") return;
    setLoading(true);
    try {
      const res = await client.request<{ sessions: Array<Record<string, unknown>> }>(
        "sessions.list",
        { limit: 100 },
      );
      const mapped = (res?.sessions || []).map((s) => ({
        key: String(s.key || ""),
        title: s.label ? String(s.label) : undefined,
        updatedAt: typeof s.updatedAt === "number" ? new Date(s.updatedAt).toISOString() : undefined,
        ...s,
      })) as Session[];
      setSessions(mapped);
      lastRefreshRef.current = Date.now();
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, [client, state]);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  // Auto-refresh on agent lifecycle events
  useEffect(() => {
    if (!client) return;
    const unsub = client.onEvent((frame) => {
      if (frame.event !== "agent") return;
      const raw = frame.payload as Record<string, unknown>;
      const stream = raw.stream as string | undefined;
      const data = raw.data as Record<string, unknown> | undefined;
      if (stream === "lifecycle" && (data?.phase === "run-end" || data?.phase === "run-start")) {
        const now = Date.now();
        if (now - lastRefreshRef.current > 2000) fetchSessions();
      }
    });
    return unsub;
  }, [client, fetchSessions]);

  return { sessions, loading, refresh: fetchSessions };
}
