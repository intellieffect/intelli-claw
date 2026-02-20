"use client";

import { useState, useCallback, useEffect, useRef, memo } from "react";
import { ChevronDown, ChevronRight, Plus, X, Pencil, Check } from "lucide-react";

export interface TaskItem {
  id: string;
  text: string;
  status: "pending" | "in-progress" | "done";
}

export interface TaskMemoData {
  items: TaskItem[];
  updatedAt: number;
}

const STATUS_ICONS: Record<TaskItem["status"], string> = {
  pending: "⬜",
  "in-progress": "🔄",
  done: "✅",
};

const STATUS_CYCLE: TaskItem["status"][] = ["pending", "in-progress", "done"];

// --- localStorage helpers ---

function storageKey(sessionKey: string) {
  return `awf:task-memo:${sessionKey}`;
}

function loadMemo(sessionKey: string): TaskMemoData {
  if (typeof window === "undefined") return { items: [], updatedAt: 0 };
  try {
    const raw = localStorage.getItem(storageKey(sessionKey));
    if (!raw) return { items: [], updatedAt: 0 };
    return JSON.parse(raw);
  } catch {
    return { items: [], updatedAt: 0 };
  }
}

function saveMemo(sessionKey: string, data: TaskMemoData) {
  if (typeof window === "undefined") return;
  localStorage.setItem(storageKey(sessionKey), JSON.stringify(data));
}

// --- Parse task-memo from assistant messages ---

const TASK_MEMO_RE = /<!--\s*task-memo:\s*(\{[\s\S]*?\})\s*-->/;

function extractText(msg: Record<string, unknown>): string {
  const content = msg.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return (content as Array<{ type?: string; text?: string }>)
      .filter((c) => c.type === "text" && typeof c.text === "string")
      .map((c) => c.text!)
      .join("\n");
  }
  if (typeof msg.text === "string") return msg.text;
  return "";
}

function parseItemEntry(item: string | TaskItem, idx: number): TaskItem {
  if (typeof item === "string") {
    const status = item.startsWith("✅")
      ? "done"
      : item.startsWith("🔄")
        ? "in-progress"
        : "pending";
    const cleanText = item.replace(/^[✅🔄⬜]\s*/, "");
    return { id: `auto-${idx}`, text: cleanText, status };
  }
  return { id: item.id || `auto-${idx}`, text: item.text, status: item.status || "pending" };
}

export function parseTaskMemoFromMessages(messages: Array<Record<string, unknown>>): TaskItem[] | null {
  // Scan from latest to earliest, return first match
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== "assistant") continue;

    const text = extractText(msg);
    const match = text.match(TASK_MEMO_RE);
    if (match) {
      try {
        const parsed = JSON.parse(match[1]);
        if (Array.isArray(parsed.items)) {
          return parsed.items.map(parseItemEntry);
        }
      } catch {
        // ignore parse errors
      }
    }
  }
  return null;
}

// --- Component ---

interface TaskMemoProps {
  sessionKey: string;
  messages: Array<Record<string, unknown>>;
}

export const TaskMemo = memo(function TaskMemo({ sessionKey, messages }: TaskMemoProps) {
  const [memo, setMemo] = useState<TaskMemoData>(() => loadMemo(sessionKey));
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("awf:task-memo:collapsed") === "true";
  });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [addingNew, setAddingNew] = useState(false);
  const [newText, setNewText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const lastAutoUpdateRef = useRef<number>(0);

  // Reload memo when session changes
  useEffect(() => {
    setMemo(loadMemo(sessionKey));
  }, [sessionKey]);

  // Auto-update from assistant messages
  // Derive a lightweight fingerprint so the effect fires on content changes
  const msgFingerprint = messages.length > 0
    ? `${messages.length}:${extractText(messages[messages.length - 1]).length}`
    : "0:0";

  useEffect(() => {
    const autoItems = parseTaskMemoFromMessages(messages);
    if (!autoItems) return;
    const now = Date.now();
    if (now - lastAutoUpdateRef.current < 300) return;
    lastAutoUpdateRef.current = now;

    const newMemo: TaskMemoData = {
      items: autoItems,
      updatedAt: now,
    };
    setMemo(newMemo);
    saveMemo(sessionKey, newMemo);
  }, [messages, sessionKey, msgFingerprint]);

  const updateMemo = useCallback(
    (updater: (prev: TaskMemoData) => TaskMemoData) => {
      setMemo((prev) => {
        const next = updater(prev);
        next.updatedAt = Date.now();
        saveMemo(sessionKey, next);
        return next;
      });
    },
    [sessionKey]
  );

  const toggleCollapsed = () => {
    const next = !collapsed;
    setCollapsed(next);
    localStorage.setItem("awf:task-memo:collapsed", String(next));
  };

  const cycleStatus = (id: string) => {
    updateMemo((prev) => ({
      ...prev,
      items: prev.items.map((item) => {
        if (item.id !== id) return item;
        const idx = STATUS_CYCLE.indexOf(item.status);
        return { ...item, status: STATUS_CYCLE[(idx + 1) % STATUS_CYCLE.length] };
      }),
    }));
  };

  const removeItem = (id: string) => {
    updateMemo((prev) => ({
      ...prev,
      items: prev.items.filter((item) => item.id !== id),
    }));
  };

  const startEdit = (item: TaskItem) => {
    setEditingId(item.id);
    setEditText(item.text);
  };

  const commitEdit = () => {
    if (!editingId) return;
    const text = editText.trim();
    if (text) {
      updateMemo((prev) => ({
        ...prev,
        items: prev.items.map((item) =>
          item.id === editingId ? { ...item, text } : item
        ),
      }));
    }
    setEditingId(null);
    setEditText("");
  };

  const addItem = () => {
    const text = newText.trim();
    if (!text) {
      setAddingNew(false);
      return;
    }
    updateMemo((prev) => ({
      ...prev,
      items: [
        ...prev.items,
        { id: `manual-${Date.now()}`, text, status: "pending" as const },
      ],
    }));
    setNewText("");
    setAddingNew(false);
  };

  useEffect(() => {
    if (addingNew && inputRef.current) inputRef.current.focus();
  }, [addingNew]);

  const hasItems = memo.items.length > 0;

  // Don't render anything if no items and collapsed
  if (!hasItems && collapsed) return null;

  return (
    <div className="border-b border-border/60 bg-background/40">
      {/* Header */}
      <button
        className="flex w-full items-center gap-1.5 px-3 py-1 text-[11px] font-medium text-muted-foreground hover:text-muted-foreground transition-colors"
        onClick={toggleCollapsed}
      >
        {collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
        <span>Tasks</span>
        {hasItems && (
          <span className="text-muted-foreground">
            ({memo.items.filter((i) => i.status === "done").length}/{memo.items.length})
          </span>
        )}
        {!collapsed && (
          <span
            role="button"
            tabIndex={0}
            className="ml-auto rounded p-0.5 text-muted-foreground hover:text-muted-foreground hover:bg-muted cursor-pointer"
            onClick={(e) => {
              e.stopPropagation();
              setAddingNew(true);
              setCollapsed(false);
            }}
            title="Add task"
          >
            <Plus size={12} />
          </span>
        )}
      </button>

      {/* Items */}
      {!collapsed && (
        <div className="px-3 pb-1.5 space-y-0.5">
          {memo.items.map((item) => (
            <div
              key={item.id}
              className="group flex items-center gap-1.5 rounded px-1 py-0.5 text-[11px] hover:bg-muted/50"
            >
              <button
                className="shrink-0 cursor-pointer"
                onClick={() => cycleStatus(item.id)}
                title="Toggle status"
              >
                {STATUS_ICONS[item.status]}
              </button>

              {editingId === item.id ? (
                <input
                  className="flex-1 bg-transparent text-foreground outline-none border-b border-border text-[11px]"
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  onBlur={commitEdit}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitEdit();
                    if (e.key === "Escape") {
                      setEditingId(null);
                      setEditText("");
                    }
                  }}
                  autoFocus
                />
              ) : (
                <span
                  className={`flex-1 cursor-default ${
                    item.status === "done" ? "text-muted-foreground line-through" : "text-muted-foreground"
                  }`}
                  onDoubleClick={() => startEdit(item)}
                >
                  {item.text}
                </span>
              )}

              <div className="hidden group-hover:flex items-center gap-0.5">
                <button
                  className="rounded p-0.5 text-muted-foreground hover:text-muted-foreground"
                  onClick={() => startEdit(item)}
                  title="Edit"
                >
                  <Pencil size={10} />
                </button>
                <button
                  className="rounded p-0.5 text-muted-foreground hover:text-destructive"
                  onClick={() => removeItem(item.id)}
                  title="Remove"
                >
                  <X size={10} />
                </button>
              </div>
            </div>
          ))}

          {/* Add new item */}
          {addingNew && (
            <div className="flex items-center gap-1.5 px-1 py-0.5">
              <span className="shrink-0">⬜</span>
              <input
                ref={inputRef}
                className="flex-1 bg-transparent text-foreground outline-none border-b border-border text-[11px] placeholder-muted-foreground"
                placeholder="New task..."
                value={newText}
                onChange={(e) => setNewText(e.target.value)}
                onBlur={addItem}
                onKeyDown={(e) => {
                  if (e.key === "Enter") addItem();
                  if (e.key === "Escape") {
                    setAddingNew(false);
                    setNewText("");
                  }
                }}
              />
            </div>
          )}

          {!hasItems && !addingNew && (
            <div className="px-1 py-0.5 text-[10px] text-muted-foreground italic">
              No tasks yet. Click + to add.
            </div>
          )}
        </div>
      )}
    </div>
  );
});
