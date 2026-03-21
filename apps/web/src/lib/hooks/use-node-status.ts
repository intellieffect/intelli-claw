import { useState, useEffect, useCallback } from "react";
import { usePageVisibility } from "./use-page-visibility";

type NodeState = "disabled" | "disconnected" | "connecting" | "authenticating" | "connected";

/**
 * useNodeStatus — Electron-only hook for managing the node-role connection.
 * Returns null on web (non-Electron) environments.
 *
 * #260: Pauses 3s polling when the page is hidden (background window)
 * to reduce CPU/network usage. Resumes immediately when visible.
 */
export function useNodeStatus() {
  const electronAPI = (window as any).electronAPI;
  const isElectron = !!electronAPI?.node;
  const visible = usePageVisibility();

  const [nodeState, setNodeState] = useState<NodeState>("disabled");
  const [loading, setLoading] = useState(false);

  // Poll node status periodically (node connection state lives in main process)
  // #260: Only poll when page is visible; immediately poll on becoming visible
  useEffect(() => {
    if (!isElectron || !visible) return;

    const poll = async () => {
      try {
        const status = await electronAPI.node.status();
        setNodeState(status as NodeState);
      } catch {
        setNodeState("disabled");
      }
    };

    poll();
    const interval = setInterval(poll, 3000);
    return () => clearInterval(interval);
  }, [isElectron, visible]);

  const enable = useCallback(async (url: string, token: string) => {
    if (!isElectron) return;
    setLoading(true);
    try {
      const status = await electronAPI.node.enable(url, token);
      setNodeState(status as NodeState);
    } finally {
      setLoading(false);
    }
  }, [isElectron]);

  const disable = useCallback(async () => {
    if (!isElectron) return;
    setLoading(true);
    try {
      const status = await electronAPI.node.disable();
      setNodeState(status as NodeState);
    } finally {
      setLoading(false);
    }
  }, [isElectron]);

  if (!isElectron) return null;

  return { nodeState, loading, enable, disable };
}
