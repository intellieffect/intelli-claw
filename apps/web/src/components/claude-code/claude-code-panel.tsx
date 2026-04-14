/**
 * ClaudeCodePanel — Web chat panel connected to a live Claude Code session
 * via the webchat channel plugin (same mechanism as the Telegram plugin).
 */

import { useCallback, useState } from "react";
import { Terminal, Wifi, X } from "lucide-react";
import { cn } from "@intelli-claw/shared";
import { useClaudeCode, type BridgeStatus } from "@/lib/claude-code";
import { MessageList } from "@/components/chat/message-list";
import { ChatInput } from "@/components/chat/chat-input";
import { Button } from "@/components/ui/button";

function StatusBadge({ status }: { status: BridgeStatus }) {
  const config: Record<BridgeStatus, { label: string; color: string }> = {
    disconnected: { label: "연결 안됨", color: "bg-zinc-500" },
    connecting: { label: "연결 중…", color: "bg-yellow-500 animate-pulse" },
    ready: { label: "연결됨", color: "bg-green-500" },
    error: { label: "오류", color: "bg-red-500" },
  };

  const { label, color } = config[status] || config.disconnected;

  return (
    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <span className={cn("inline-block h-2 w-2 rounded-full", color)} />
      <span>{label}</span>
    </div>
  );
}

export function ClaudeCodePanel() {
  const {
    messages,
    status,
    streaming,
    agentStatus,
    connect,
    disconnect,
    sendMessage,
    clearMessages,
  } = useClaudeCode({ autoConnect: true });

  const isConnected = status === "ready";

  const handleSend = useCallback(
    (text: string) => {
      if (!text.trim()) return;
      sendMessage(text);
    },
    [sendMessage],
  );

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-2">
        <div className="flex items-center gap-2">
          <Terminal size={16} className="text-muted-foreground" />
          <span className="text-sm font-medium">Claude Code</span>
        </div>

        <div className="flex items-center gap-2">
          <StatusBadge status={status} />

          {!isConnected ? (
            <Button
              size="sm"
              variant="outline"
              onClick={connect}
              className="h-7 gap-1 px-2 text-xs"
            >
              <Wifi size={12} />
              연결
            </Button>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => { disconnect(); clearMessages(); }}
              className="h-7 gap-1 px-2 text-xs text-muted-foreground"
            >
              <X size={12} />
              종료
            </Button>
          )}
        </div>
      </div>

      {/* Messages */}
      <div className="min-h-0 flex-1 overflow-hidden">
        {!isConnected && messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-4 text-muted-foreground">
            <Terminal size={48} className="opacity-30" />
            <div className="text-center">
              <p className="text-sm font-medium">Claude Code</p>
              <p className="mt-1 text-xs">실행 중인 Claude Code 세션에 연결합니다</p>
              <p className="mt-0.5 text-xs opacity-60">API 추가 과금 없음 — 로그인된 계정 사용</p>
              <p className="mt-3 rounded bg-muted/50 px-3 py-2 text-left font-mono text-[11px] leading-relaxed">
                tmux에서 먼저 실행:<br />
                <span className="text-foreground">pnpm claude:webchat</span>
              </p>
            </div>
            <Button onClick={connect} variant="outline" className="gap-2">
              <Wifi size={14} />
              연결하기
            </Button>
          </div>
        ) : (
          <MessageList
            messages={messages}
            loading={false}
            streaming={streaming}
            agentStatus={agentStatus}
          />
        )}
      </div>

      {/* Input */}
      {isConnected && (
        <div className="border-t border-border px-2 pb-2 pt-1 md:px-3">
          <ChatInput
            onSend={handleSend}
            onAbort={() => {}}
            streaming={streaming}
            disabled={!isConnected}
            agentStatus={agentStatus}
            model="Claude Code"
          />
        </div>
      )}
    </div>
  );
}
