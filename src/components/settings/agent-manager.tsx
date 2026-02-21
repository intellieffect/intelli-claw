"use client";

import { useState, useEffect, useCallback } from "react";
import { Bot, Plus, Pencil, Trash2, Save, X, ChevronRight } from "lucide-react";
import { useGateway, useAgents } from "@/lib/gateway/hooks";
import type { Agent } from "@/lib/gateway/protocol";
import { getAgentAvatar } from "@/lib/agent-avatars";
import { cn } from "@/lib/utils";

// --- Agent form fields ---
interface AgentFormData {
  id: string;
  name: string;
  model: string;
  description: string;
  systemPrompt: string;
}

const EMPTY_FORM: AgentFormData = { id: "", name: "", model: "", description: "", systemPrompt: "" };

// --- New Session Picker (agent selection → callback) ---

export function NewSessionPicker({
  open,
  onClose,
  onSelect,
  onManageAgents,
}: {
  open: boolean;
  onClose: () => void;
  onSelect: (agentId: string) => void;
  onManageAgents: () => void;
}) {
  const { agents, refresh } = useAgents();
  const [focusIndex, setFocusIndex] = useState(0);

  useEffect(() => {
    if (open) { refresh(); setFocusIndex(0); }
  }, [open, refresh]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") { onClose(); return; }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setFocusIndex((prev) => (prev + 1) % (agents.length || 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setFocusIndex((prev) => (prev - 1 + (agents.length || 1)) % (agents.length || 1));
        return;
      }
      if (e.key === "Enter" && agents.length > 0) {
        e.preventDefault();
        onSelect(agents[focusIndex].id);
        onClose();
        return;
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose, onSelect, agents, focusIndex]);

  // Scroll focused item into view
  useEffect(() => {
    if (!open) return;
    const el = document.querySelector(`[data-agent-index="${focusIndex}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [focusIndex, open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[150]" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="absolute left-1/2 top-1/2 w-[min(92vw,480px)] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
          <h3 className="text-sm font-semibold text-zinc-100">새 세션 — 에이전트 선택</h3>
          <div className="flex items-center gap-2 text-[10px] text-zinc-500">
            <span>↑↓ 이동</span>
            <span>Enter 선택</span>
            <button onClick={onClose} className="rounded px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200">ESC</button>
          </div>
        </div>
        <div className="max-h-[60vh] overflow-y-auto p-2">
          {agents.map((agent, index) => {
            const av = getAgentAvatar(agent.id);
            const isFocused = index === focusIndex;
            return (
              <button
                key={agent.id}
                data-agent-index={index}
                onClick={() => { onSelect(agent.id); onClose(); }}
                onMouseEnter={() => setFocusIndex(index)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left transition",
                  isFocused ? "bg-zinc-800 ring-1 ring-zinc-600" : "hover:bg-zinc-800"
                )}
              >
                {av.imageUrl ? (
                  <img src={av.imageUrl} alt={agent.id} className="size-9 rounded-full object-cover shrink-0" />
                ) : (
                  <div className={cn("flex size-9 shrink-0 items-center justify-center rounded-full text-base", av.color)}>
                    {av.emoji}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-zinc-100 truncate">{agent.name || agent.id}</div>
                  {agent.description && (
                    <div className="text-xs text-zinc-500 truncate">{agent.description}</div>
                  )}
                  {agent.model && (
                    <div className="text-[10px] text-zinc-600 truncate">{agent.model}</div>
                  )}
                </div>
                <ChevronRight size={14} className={isFocused ? "text-zinc-300" : "text-zinc-600"} />
              </button>
            );
          })}

          {agents.length === 0 && (
            <div className="py-8 text-center text-sm text-zinc-500">에이전트가 없습니다</div>
          )}
        </div>
        <div className="border-t border-zinc-800 px-3 py-2">
          <button
            onClick={() => { onClose(); onManageAgents(); }}
            className="flex w-full items-center justify-center gap-1.5 rounded-md bg-zinc-800 py-2 text-xs text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"
          >
            <Bot size={12} />
            에이전트 관리
          </button>
        </div>
      </div>
    </div>
  );
}

// --- Agent Manager (CRUD) ---

export function AgentManager({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { client, state } = useGateway();
  const { agents, refresh } = useAgents();
  const isConnected = state === "connected";

  const [editingAgent, setEditingAgent] = useState<AgentFormData | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [loading, setLoading] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      refresh();
      setEditingAgent(null);
      setIsNew(false);
      setConfirmDeleteId(null);
    }
  }, [open, refresh]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (editingAgent) { setEditingAgent(null); setIsNew(false); }
        else onClose();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, editingAgent, onClose]);

  const startCreate = () => {
    setEditingAgent({ ...EMPTY_FORM });
    setIsNew(true);
  };

  const startEdit = (agent: Agent) => {
    setEditingAgent({
      id: agent.id,
      name: agent.name || "",
      model: agent.model || "",
      description: agent.description || "",
      systemPrompt: agent.systemPrompt || "",
    });
    setIsNew(false);
  };

  const saveAgent = useCallback(async () => {
    if (!client || !isConnected || !editingAgent) return;
    if (!editingAgent.id.trim() || !editingAgent.name.trim()) return;

    setLoading(true);
    try {
      // Get current config
      const config = await client.request<{ config: Record<string, unknown> }>("config.get");
      const currentAgents = ((config?.config as any)?.agents?.list || {}) as Record<string, unknown>;

      // Build agent config entry
      const agentEntry: Record<string, unknown> = {};
      if (editingAgent.name) agentEntry.name = editingAgent.name;
      if (editingAgent.model) agentEntry.model = editingAgent.model;
      if (editingAgent.description) agentEntry.description = editingAgent.description;
      if (editingAgent.systemPrompt) agentEntry.systemPrompt = editingAgent.systemPrompt;

      // Merge with existing (preserve fields we don't edit like workspace, heartbeat, etc.)
      const existing = (currentAgents[editingAgent.id] || {}) as Record<string, unknown>;
      const merged = { ...existing, ...agentEntry };

      // Patch config
      await client.request("config.patch", {
        patch: {
          agents: {
            list: {
              [editingAgent.id]: merged,
            },
          },
        },
      });

      await refresh();
      setEditingAgent(null);
      setIsNew(false);
    } catch (err) {
      console.error("[AWF] save agent error:", err);
    } finally {
      setLoading(false);
    }
  }, [client, isConnected, editingAgent, refresh]);

  const deleteAgent = useCallback(async (id: string) => {
    if (!client || !isConnected) return;
    setLoading(true);
    try {
      // Get current config, remove agent
      const config = await client.request<{ config: Record<string, unknown> }>("config.get");
      const currentAgents = { ...((config?.config as any)?.agents?.list || {}) } as Record<string, unknown>;
      delete currentAgents[id];

      await client.request("config.apply", {
        config: {
          ...((config?.config) || {}),
          agents: {
            ...((config?.config as any)?.agents || {}),
            list: currentAgents,
          },
        },
      });

      await refresh();
      setConfirmDeleteId(null);
    } catch (err) {
      console.error("[AWF] delete agent error:", err);
    } finally {
      setLoading(false);
    }
  }, [client, isConnected, refresh]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[160]" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="absolute left-1/2 top-1/2 w-[min(92vw,600px)] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
          <h3 className="text-sm font-semibold text-zinc-100">
            {editingAgent ? (isNew ? "에이전트 생성" : "에이전트 수정") : "에이전트 관리"}
          </h3>
          <button onClick={() => { if (editingAgent) { setEditingAgent(null); setIsNew(false); } else onClose(); }}
            className="rounded px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200">
            {editingAgent ? "뒤로" : "ESC"}
          </button>
        </div>

        {editingAgent ? (
          /* --- Edit / Create form --- */
          <div className="space-y-3 p-4">
            <div>
              <label className="mb-1 block text-[11px] font-medium text-zinc-500">ID</label>
              <input
                value={editingAgent.id}
                onChange={(e) => setEditingAgent({ ...editingAgent, id: e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, "") })}
                disabled={!isNew}
                placeholder="my-agent"
                className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-zinc-600 disabled:opacity-50"
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-medium text-zinc-500">이름</label>
              <input
                value={editingAgent.name}
                onChange={(e) => setEditingAgent({ ...editingAgent, name: e.target.value })}
                placeholder="My Agent"
                className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-zinc-600"
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-medium text-zinc-500">모델 (선택)</label>
              <input
                value={editingAgent.model}
                onChange={(e) => setEditingAgent({ ...editingAgent, model: e.target.value })}
                placeholder="anthropic/claude-sonnet-4-20250514"
                className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-zinc-600"
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-medium text-zinc-500">설명 (선택)</label>
              <input
                value={editingAgent.description}
                onChange={(e) => setEditingAgent({ ...editingAgent, description: e.target.value })}
                placeholder="이 에이전트의 역할 설명"
                className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-zinc-600"
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-medium text-zinc-500">시스템 프롬프트 (선택)</label>
              <textarea
                value={editingAgent.systemPrompt}
                onChange={(e) => setEditingAgent({ ...editingAgent, systemPrompt: e.target.value })}
                placeholder="에이전트의 성격과 역할을 정의하세요..."
                rows={4}
                className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-zinc-600 resize-y"
              />
            </div>
            <button
              onClick={saveAgent}
              disabled={loading || !editingAgent.id.trim() || !editingAgent.name.trim()}
              className="flex w-full items-center justify-center gap-1.5 rounded-md bg-amber-600/80 py-2 text-sm font-medium text-white hover:bg-amber-600 disabled:opacity-40"
            >
              <Save size={14} />
              {isNew ? "생성" : "저장"}
            </button>
          </div>
        ) : (
          /* --- Agent list --- */
          <>
            <div className="max-h-[55vh] overflow-y-auto p-2">
              {agents.map((agent) => {
                const av = getAgentAvatar(agent.id);
                const isDeleting = confirmDeleteId === agent.id;

                return (
                  <div key={agent.id} className="flex items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-zinc-800/50">
                    {av.imageUrl ? (
                      <img src={av.imageUrl} alt={agent.id} className="size-8 rounded-full object-cover shrink-0" />
                    ) : (
                      <div className={cn("flex size-8 shrink-0 items-center justify-center rounded-full text-sm", av.color)}>
                        {av.emoji}
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-zinc-200 truncate">{agent.name || agent.id}</div>
                      <div className="text-[10px] text-zinc-600 truncate">{agent.id} · {agent.model || "default"}</div>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => startEdit(agent)}
                        className="rounded p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
                        title="수정"
                      >
                        <Pencil size={13} />
                      </button>
                      {isDeleting ? (
                        <div className="flex gap-1">
                          <button
                            onClick={() => deleteAgent(agent.id)}
                            disabled={loading}
                            className="rounded px-2 py-1 text-[10px] bg-red-600/80 text-white hover:bg-red-600"
                          >
                            확인
                          </button>
                          <button
                            onClick={() => setConfirmDeleteId(null)}
                            className="rounded px-2 py-1 text-[10px] bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
                          >
                            취소
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setConfirmDeleteId(agent.id)}
                          className="rounded p-1.5 text-zinc-600 hover:bg-zinc-800 hover:text-red-400"
                          title="삭제"
                        >
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}

              {agents.length === 0 && (
                <div className="py-8 text-center text-sm text-zinc-500">등록된 에이전트가 없습니다</div>
              )}
            </div>
            <div className="border-t border-zinc-800 px-3 py-2">
              <button
                onClick={startCreate}
                className="flex w-full items-center justify-center gap-1.5 rounded-md bg-zinc-800 py-2 text-xs text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"
              >
                <Plus size={12} />
                새 에이전트 생성
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
