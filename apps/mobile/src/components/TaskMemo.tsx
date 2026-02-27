/**
 * TaskMemo — Collapsible task list that syncs with assistant messages.
 * Ported from web task-memo.tsx for React Native.
 *
 * Features:
 * - Parses <!-- task-memo: {...} --> from assistant messages
 * - Status cycling: ⬜ → 🔄 → ✅
 * - Persisted to AsyncStorage
 * - Collapsible with progress count
 * - Add/edit/remove tasks
 */
import React, { useState, useCallback, useEffect, useRef, memo } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  LayoutAnimation,
  Platform,
  UIManager,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { ChevronDown, ChevronRight, Plus, X, Pencil, Check } from "lucide-react-native";

// Enable LayoutAnimation on Android
if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

// ─── Types ───

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

// ─── Storage helpers ───

function storageKey(sessionKey: string) {
  return `awf:task-memo:${sessionKey}`;
}

async function loadMemo(sessionKey: string): Promise<TaskMemoData> {
  try {
    const raw = await AsyncStorage.getItem(storageKey(sessionKey));
    if (!raw) return { items: [], updatedAt: 0 };
    return JSON.parse(raw);
  } catch {
    return { items: [], updatedAt: 0 };
  }
}

async function saveMemo(sessionKey: string, data: TaskMemoData) {
  await AsyncStorage.setItem(storageKey(sessionKey), JSON.stringify(data));
}

// ─── Parse task-memo from messages ───

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
        // ignore
      }
    }
  }
  return null;
}

// ─── Component ───

interface TaskMemoProps {
  sessionKey: string;
  messages: Array<Record<string, unknown>>;
}

export const TaskMemo = memo(function TaskMemo({ sessionKey, messages }: TaskMemoProps) {
  const [memoData, setMemoData] = useState<TaskMemoData>({ items: [], updatedAt: 0 });
  const [collapsed, setCollapsed] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [addingNew, setAddingNew] = useState(false);
  const [newText, setNewText] = useState("");
  const lastAutoUpdateRef = useRef<number>(0);

  // Load memo on session change
  useEffect(() => {
    loadMemo(sessionKey).then(setMemoData);
  }, [sessionKey]);

  // Auto-update from assistant messages
  const msgFingerprint = messages.length > 0
    ? `${messages.length}:${extractText(messages[messages.length - 1]).length}`
    : "0:0";

  useEffect(() => {
    const autoItems = parseTaskMemoFromMessages(messages);
    if (!autoItems) return;
    const now = Date.now();
    if (now - lastAutoUpdateRef.current < 300) return;
    lastAutoUpdateRef.current = now;

    const newMemo: TaskMemoData = { items: autoItems, updatedAt: now };
    setMemoData(newMemo);
    saveMemo(sessionKey, newMemo);
  }, [messages, sessionKey, msgFingerprint]);

  const updateMemo = useCallback(
    (updater: (prev: TaskMemoData) => TaskMemoData) => {
      setMemoData((prev) => {
        const next = updater(prev);
        next.updatedAt = Date.now();
        saveMemo(sessionKey, next);
        return next;
      });
    },
    [sessionKey],
  );

  const toggleCollapsed = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setCollapsed((prev) => !prev);
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

  const commitEdit = () => {
    if (!editingId) return;
    const text = editText.trim();
    if (text) {
      updateMemo((prev) => ({
        ...prev,
        items: prev.items.map((item) =>
          item.id === editingId ? { ...item, text } : item,
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

  const hasItems = memoData.items.length > 0;
  if (!hasItems && collapsed) return null;

  const doneCount = memoData.items.filter((i) => i.status === "done").length;

  return (
    <View style={s.container}>
      {/* Header */}
      <TouchableOpacity style={s.header} onPress={toggleCollapsed} activeOpacity={0.7}>
        {collapsed ? (
          <ChevronRight size={14} color="#9CA3AF" />
        ) : (
          <ChevronDown size={14} color="#9CA3AF" />
        )}
        <Text style={s.headerLabel}>Tasks</Text>
        {hasItems && (
          <Text style={s.headerCount}>({doneCount}/{memoData.items.length})</Text>
        )}
        {!collapsed && (
          <TouchableOpacity
            onPress={() => { setAddingNew(true); setCollapsed(false); }}
            style={s.addBtn}
            hitSlop={8}
          >
            <Plus size={14} color="#9CA3AF" />
          </TouchableOpacity>
        )}
      </TouchableOpacity>

      {/* Items */}
      {!collapsed && (
        <View style={s.itemList}>
          {memoData.items.map((item) => (
            <View key={item.id} style={s.itemRow}>
              <TouchableOpacity onPress={() => cycleStatus(item.id)} hitSlop={4}>
                <Text style={s.statusIcon}>{STATUS_ICONS[item.status]}</Text>
              </TouchableOpacity>

              {editingId === item.id ? (
                <TextInput
                  style={s.editInput}
                  value={editText}
                  onChangeText={setEditText}
                  onBlur={commitEdit}
                  onSubmitEditing={commitEdit}
                  autoFocus
                />
              ) : (
                <TouchableOpacity
                  style={s.itemTextWrap}
                  onPress={() => {
                    setEditingId(item.id);
                    setEditText(item.text);
                  }}
                  activeOpacity={0.7}
                >
                  <Text
                    style={[s.itemText, item.status === "done" && s.itemTextDone]}
                    numberOfLines={2}
                  >
                    {item.text}
                  </Text>
                </TouchableOpacity>
              )}

              <TouchableOpacity onPress={() => removeItem(item.id)} hitSlop={8}>
                <X size={12} color="#D1D5DB" />
              </TouchableOpacity>
            </View>
          ))}

          {/* Add new */}
          {addingNew && (
            <View style={s.itemRow}>
              <Text style={s.statusIcon}>⬜</Text>
              <TextInput
                style={s.editInput}
                placeholder="새 작업..."
                placeholderTextColor="#D1D5DB"
                value={newText}
                onChangeText={setNewText}
                onBlur={addItem}
                onSubmitEditing={addItem}
                autoFocus
              />
            </View>
          )}

          {!hasItems && !addingNew && (
            <Text style={s.emptyText}>작업 없음. + 를 눌러 추가하세요.</Text>
          )}
        </View>
      )}
    </View>
  );
});

const s = StyleSheet.create({
  container: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#E5E7EB",
    backgroundColor: "#FAFAFA",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  headerLabel: { fontSize: 12, fontWeight: "600", color: "#9CA3AF" },
  headerCount: { fontSize: 11, color: "#D1D5DB" },
  addBtn: { marginLeft: "auto", padding: 4 },

  itemList: { paddingHorizontal: 12, paddingBottom: 8 },
  itemRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 4,
  },
  statusIcon: { fontSize: 14, width: 22, textAlign: "center" },
  itemTextWrap: { flex: 1 },
  itemText: { fontSize: 13, color: "#374151", lineHeight: 18 },
  itemTextDone: { textDecorationLine: "line-through", color: "#D1D5DB" },
  editInput: {
    flex: 1,
    fontSize: 13,
    color: "#111827",
    borderBottomWidth: 1,
    borderBottomColor: "#3B82F6",
    paddingVertical: 2,
  },
  emptyText: { fontSize: 11, color: "#D1D5DB", fontStyle: "italic", paddingVertical: 4 },
});
