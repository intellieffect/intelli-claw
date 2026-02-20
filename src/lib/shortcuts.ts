export type ShortcutDef = {
  id: string;
  keys: string;
  description: string;
  scope?: "global" | "panel";
};

export const SHORTCUTS: ShortcutDef[] = [
  { id: "help", keys: "Cmd+/", description: "단축키 도움말 열기", scope: "global" },
  { id: "add-panel", keys: "Cmd+\\", description: "패널 추가", scope: "global" },
  { id: "focus-left", keys: "Ctrl+H", description: "왼쪽 패널 포커스", scope: "global" },
  { id: "focus-right", keys: "Ctrl+L", description: "오른쪽 패널 포커스", scope: "global" },
  { id: "move-left", keys: "Ctrl+Shift+H", description: "현재 패널 왼쪽으로 이동", scope: "global" },
  { id: "move-right", keys: "Ctrl+Shift+L", description: "현재 패널 오른쪽으로 이동", scope: "global" },
  { id: "close-panel", keys: "Ctrl+X", description: "현재 패널 닫기", scope: "global" },
  { id: "reopen-panel", keys: "Ctrl+Shift+X", description: "닫은 패널 다시 열기", scope: "global" },
  { id: "new-session", keys: "Ctrl+N", description: "현재 패널 새 세션", scope: "panel" },
  { id: "abort-stream", keys: "Ctrl+C", description: "스트리밍 중지", scope: "panel" },
  { id: "session-switcher", keys: "Cmd+K", description: "세션 스위처 열기", scope: "panel" },
];

export function isShortcutHelp(e: KeyboardEvent) {
  // Cmd+/ on mac, Ctrl+/ on others (some layouts emit '?')
  return (e.metaKey || e.ctrlKey) && (e.key === "/" || e.key === "?");
}
