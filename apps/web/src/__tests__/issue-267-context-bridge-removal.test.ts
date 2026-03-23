/**
 * #267 — 세션 갱신 시 '이전 맥락 불러오기' 자동화 필요
 *
 * 결론: Gateway가 세션 reset 시 자체적으로 맥락을 전달하므로,
 * 클라이언트의 context bridge 버튼은 불필요. 제거 대상.
 *
 * 검증 대상:
 * 1. SessionBoundary에서 "이전 맥락 불러오기" 버튼이 제거되었는지
 * 2. "이전 대화 보기" 버튼은 유지되는지
 * 3. useChat 반환값에서 sendContextBridge가 제거되었는지
 * 4. onLoadPreviousContext prop이 제거되었는지
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const MESSAGE_LIST_PATH = path.resolve(__dirname, "../components/chat/message-list.tsx");
const HOOKS_PATH = path.resolve(__dirname, "../lib/gateway/hooks.tsx");
const CHAT_PANEL_PATH = path.resolve(__dirname, "../components/chat/chat-panel.tsx");

describe("#267 — context bridge 버튼 제거", () => {
  const messageListSrc = fs.readFileSync(MESSAGE_LIST_PATH, "utf-8");
  const hooksSrc = fs.readFileSync(HOOKS_PATH, "utf-8");
  const chatPanelSrc = fs.readFileSync(CHAT_PANEL_PATH, "utf-8");

  it("SessionBoundary에서 '이전 맥락 불러오기' 텍스트가 없어야 한다", () => {
    expect(messageListSrc).not.toContain("이전 맥락 불러오기");
  });

  it("SessionBoundary에서 '맥락 전송됨' 텍스트가 없어야 한다", () => {
    expect(messageListSrc).not.toContain("맥락 전송됨");
  });

  it("SessionBoundary에서 onLoadContext prop이 없어야 한다", () => {
    // SessionBoundary 함수 시그니처에 onLoadContext가 없어야 함
    expect(messageListSrc).not.toMatch(/onLoadContext\s*[?:]/);
  });

  it("'이전 대화 보기' 버튼은 유지되어야 한다", () => {
    expect(messageListSrc).toContain("이전 대화 보기");
  });

  it("onOpenTopicHistory prop은 유지되어야 한다", () => {
    expect(messageListSrc).toContain("onOpenTopicHistory");
  });

  it("MessageList에서 onLoadPreviousContext prop이 제거되어야 한다", () => {
    // prop 정의와 사용 모두 없어야 함
    expect(messageListSrc).not.toContain("onLoadPreviousContext");
  });

  it("useChat 반환값에서 sendContextBridge가 제거되어야 한다", () => {
    // return 객체에서 sendContextBridge가 없어야 함
    const returnMatch = hooksSrc.match(/return\s*\{[^}]*sendContextBridge[^}]*\}/s);
    expect(returnMatch).toBeNull();
  });

  it("chat-panel에서 sendContextBridge 사용이 없어야 한다", () => {
    expect(chatPanelSrc).not.toContain("sendContextBridge");
  });

  it("chat-panel에서 onLoadPreviousContext prop 전달이 없어야 한다", () => {
    expect(chatPanelSrc).not.toContain("onLoadPreviousContext");
  });

  it("buildContextSummary는 hooks에 보존되어야 한다 (유틸 재활용 가능)", () => {
    expect(hooksSrc).toContain("buildContextSummary");
  });
});
