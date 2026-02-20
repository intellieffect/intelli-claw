"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { ChatPanel } from "./chat-panel";
import { useIsMobile } from "@/lib/hooks/use-mobile";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { matchesShortcutId } from "@/lib/shortcuts";

function uid() {
  return Math.random().toString(36).slice(2, 8);
}

// --- Types ---

interface PanelState {
  id: string;
  /** Flex-basis width in fractions (not percentages). All panels sum to 1. */
  width: number;
}

interface SplitState {
  panels: PanelState[];
  activePanelId: string;
}

// --- Storage helpers ---

const STORAGE_KEY = "awf:split-panels";

function loadState(): SplitState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SplitState;
    if (parsed.panels?.length >= 1) return parsed;
  } catch {}
  return null;
}

function saveState(state: SplitState) {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function defaultState(): SplitState {
  // Must be deterministic for SSR/client hydration match
  const id = "panel-1";
  return { panels: [{ id, width: 1 }], activePanelId: id };
}

// --- Helpers ---

function equalWidths(count: number): number {
  return 1 / count;
}

const MIN_PANEL_PX = 200;

// --- Component ---

export interface SplitViewProps {
  /** Number of panels requested. Controlled from parent via addPanel/removePanel. */
  panelCount?: number;
  /** Called by parent to imperatively add a panel */
  onAddPanel?: () => void;
}

export function SplitView() {
  const [state, setState] = useState<SplitState>(defaultState);
  const [hydrated, setHydrated] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ index: number; startX: number; startWidths: number[] } | null>(null);
  const closedPanelsRef = useRef<PanelState[]>([]);
  const isMobile = useIsMobile();

  // Restore from localStorage after hydration
  useEffect(() => {
    const saved = loadState();
    if (saved) setState(saved);
    setHydrated(true);
  }, []);

  // Persist on every change (only after hydration)
  useEffect(() => {
    if (hydrated) saveState(state);
  }, [state, hydrated]);

  // --- Panel management ---

  const addPanel = useCallback(() => {
    setState((prev) => {
      const newId = uid();
      const count = prev.panels.length + 1;
      const w = equalWidths(count);
      const panels = [...prev.panels.map((p) => ({ ...p, width: w })), { id: newId, width: w }];
      return { panels, activePanelId: newId };
    });
  }, []);

  const removePanel = useCallback((id: string) => {
    setState((prev) => {
      if (prev.panels.length <= 1) return prev;
      const removed = prev.panels.find((p) => p.id === id);
      if (removed) closedPanelsRef.current.push(removed);
      const remaining = prev.panels.filter((p) => p.id !== id);
      const w = equalWidths(remaining.length);
      const panels = remaining.map((p) => ({ ...p, width: w }));
      const activePanelId =
        prev.activePanelId === id ? panels[0].id : prev.activePanelId;
      return { panels, activePanelId };
    });
  }, []);

  const reopenLastClosedPanel = useCallback(() => {
    setState((prev) => {
      const last = closedPanelsRef.current.pop();
      if (!last) return prev;
      const count = prev.panels.length + 1;
      const w = equalWidths(count);
      const panels = [...prev.panels.map((p) => ({ ...p, width: w })), { ...last, width: w }];
      return { panels, activePanelId: last.id };
    });
  }, []);

  const setActive = useCallback((id: string) => {
    setState((prev) => (prev.activePanelId === id ? prev : { ...prev, activePanelId: id }));
  }, []);

  /** Navigate focus to prev (-1) or next (+1) panel */
  const navPanel = useCallback((dir: -1 | 1) => {
    setState((prev) => {
      const idx = prev.panels.findIndex((p) => p.id === prev.activePanelId);
      const next = idx + dir;
      if (next < 0 || next >= prev.panels.length) return prev;
      return { ...prev, activePanelId: prev.panels[next].id };
    });
  }, []);

  /** Move a panel's position left/right */
  const movePanel = useCallback((id: string, dir: -1 | 1) => {
    setState((prev) => {
      const idx = prev.panels.findIndex((p) => p.id === id);
      const next = idx + dir;
      if (idx < 0 || next < 0 || next >= prev.panels.length) return prev;
      const panels = [...prev.panels];
      [panels[idx], panels[next]] = [panels[next], panels[idx]];
      return { ...prev, panels };
    });
  }, []);

  /** Move currently focused panel */
  const moveActivePanel = useCallback((dir: -1 | 1) => {
    setState((prev) => {
      const idx = prev.panels.findIndex((p) => p.id === prev.activePanelId);
      const next = idx + dir;
      if (idx < 0 || next < 0 || next >= prev.panels.length) return prev;
      const panels = [...prev.panels];
      [panels[idx], panels[next]] = [panels[next], panels[idx]];
      return { ...prev, panels };
    });
  }, []);

  // Expose functions globally so chat-view can call them
  useEffect(() => {
    (window as any).__awfSplitAddPanel = addPanel;
    (window as any).__awfSplitNavPanel = navPanel;
    (window as any).__awfSplitCloseActivePanel = () => removePanel(state.activePanelId);
    (window as any).__awfSplitReopenLastPanel = reopenLastClosedPanel;
    return () => {
      delete (window as any).__awfSplitAddPanel;
      delete (window as any).__awfSplitNavPanel;
      delete (window as any).__awfSplitCloseActivePanel;
      delete (window as any).__awfSplitReopenLastPanel;
    };
  });

  // Customizable shortcuts — resolved via matchesShortcutId
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (matchesShortcutId(e, "focus-left") || matchesShortcutId(e, "focus-up")) {
        e.preventDefault(); e.stopPropagation();
        navPanel(-1);
      } else if (matchesShortcutId(e, "focus-right") || matchesShortcutId(e, "focus-down")) {
        e.preventDefault(); e.stopPropagation();
        navPanel(1);
      } else if (matchesShortcutId(e, "swap-panels")) {
        e.preventDefault(); e.stopPropagation();
        // Swap active panel with the next one (wraps around)
        setState((prev) => {
          if (prev.panels.length < 2) return prev;
          const idx = prev.panels.findIndex((p) => p.id === prev.activePanelId);
          const next = (idx + 1) % prev.panels.length;
          const panels = [...prev.panels];
          [panels[idx], panels[next]] = [panels[next], panels[idx]];
          return { ...prev, panels };
        });
      } else if (matchesShortcutId(e, "close-panel")) {
        e.preventDefault(); e.stopPropagation();
        removePanel(state.activePanelId);
      } else if (matchesShortcutId(e, "reopen-panel")) {
        e.preventDefault(); e.stopPropagation();
        reopenLastClosedPanel();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [navPanel, removePanel, reopenLastClosedPanel, state.activePanelId]);

  // --- Resize ---

  const handleMouseDown = useCallback((index: number, e: React.MouseEvent) => {
    e.preventDefault();
    dragRef.current = {
      index,
      startX: e.clientX,
      startWidths: state.panels.map((p) => p.width),
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, [state.panels]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      const drag = dragRef.current;
      if (!drag || !containerRef.current) return;
      const containerWidth = containerRef.current.getBoundingClientRect().width;
      const dx = e.clientX - drag.startX;
      const dFrac = dx / containerWidth;

      const minFrac = MIN_PANEL_PX / containerWidth;
      const widths = [...drag.startWidths];
      const i = drag.index;

      let newLeft = widths[i] + dFrac;
      let newRight = widths[i + 1] - dFrac;

      if (newLeft < minFrac) {
        newLeft = minFrac;
        newRight = widths[i] + widths[i + 1] - minFrac;
      }
      if (newRight < minFrac) {
        newRight = minFrac;
        newLeft = widths[i] + widths[i + 1] - minFrac;
      }

      widths[i] = newLeft;
      widths[i + 1] = newRight;

      setState((prev) => ({
        ...prev,
        panels: prev.panels.map((p, idx) => ({ ...p, width: widths[idx] ?? p.width })),
      }));
    };

    const handleMouseUp = () => {
      if (dragRef.current) {
        dragRef.current = null;
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      }
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, []);

  // --- Render ---

  const { panels, activePanelId } = state;

  // Mobile: show only the active panel
  const visiblePanels = isMobile
    ? panels.filter((p) => p.id === activePanelId)
    : panels;

  return (
    <div ref={containerRef} className="flex h-full">
      {visiblePanels.map((panel, i) => (
        <div key={panel.id} className="flex h-full min-w-0" style={{ flex: isMobile ? "1 0 0%" : `${panel.width} 0 0%` }}>
          {/* Panel */}
          <div
            className={`relative h-full min-w-0 flex-1 ${
              !isMobile && panel.id === activePanelId ? "ring-1 ring-blue-500/40 ring-inset" : ""
            }`}
            onClick={() => setActive(panel.id)}
          >
            {/* Panel controls (desktop only, multi-panel) */}
            {!isMobile && panels.length > 1 && (
              <div className="absolute right-2 top-2 z-30 flex items-center gap-0.5 rounded-md border border-border bg-background/80 p-0.5 backdrop-blur">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    movePanel(panel.id, -1);
                  }}
                  disabled={i === 0}
                  className="rounded p-0.5 text-muted-foreground transition enabled:hover:bg-muted enabled:hover:text-foreground disabled:opacity-30"
                  title="패널 왼쪽으로 이동"
                >
                  <ChevronLeft size={13} />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    movePanel(panel.id, 1);
                  }}
                  disabled={i === panels.length - 1}
                  className="rounded p-0.5 text-muted-foreground transition enabled:hover:bg-muted enabled:hover:text-foreground disabled:opacity-30"
                  title="패널 오른쪽으로 이동"
                >
                  <ChevronRight size={13} />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    removePanel(panel.id);
                  }}
                  className="rounded p-0.5 text-muted-foreground transition hover:bg-muted hover:text-foreground"
                  title="패널 닫기"
                >
                  <X size={13} />
                </button>
              </div>
            )}
            <ChatPanel
              panelId={panel.id}
              isActive={panel.id === activePanelId}
              onFocus={() => setActive(panel.id)}
              showHeader={true}
            />
          </div>

          {/* Resize handle between panels (desktop only) */}
          {!isMobile && i < visiblePanels.length - 1 && (
            <div
              onMouseDown={(e) => handleMouseDown(i, e)}
              className="group relative z-10 flex w-1 shrink-0 cursor-col-resize items-center justify-center bg-muted transition-colors hover:bg-primary"
            >
              <div className="absolute inset-y-0 -left-1 -right-1" />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
