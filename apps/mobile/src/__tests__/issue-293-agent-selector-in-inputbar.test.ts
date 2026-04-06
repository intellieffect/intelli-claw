/**
 * #293 — 모바일: 에이전트 선택 UI를 채팅박스 내부로 이동
 *
 * Pure structural assertions: read the source files and assert the wiring
 * we care about. We can't render React Native components inside the vitest
 * jsdom-less env without bringing in @testing-library/react-native and
 * react-native-reanimated stubs, so this test stays at the source-text
 * level — same approach as #267 context-bridge-removal.
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const ROOT = path.resolve(__dirname, "../../");

const INPUTBAR = fs.readFileSync(
  path.join(ROOT, "src/components/chat/InputBar.tsx"),
  "utf-8",
);
const AGENT_CHAT_PAGE = fs.readFileSync(
  path.join(ROOT, "src/components/chat/AgentChatPage.tsx"),
  "utf-8",
);
const TABS_INDEX = fs.readFileSync(
  path.join(ROOT, "app/(tabs)/index.tsx"),
  "utf-8",
);

describe("#293 — agent selector lives inside InputBar", () => {
  it("InputBar imports AgentTabBar", () => {
    expect(INPUTBAR).toMatch(/from\s+["']\.\/AgentTabBar["']/);
  });

  it("InputBar accepts agents/activeAgentIndex/onAgentTabPress props", () => {
    expect(INPUTBAR).toContain("agents?:");
    expect(INPUTBAR).toContain("activeAgentIndex");
    expect(INPUTBAR).toContain("onAgentTabPress");
  });

  it("InputBar renders AgentTabBar only when 2+ agents", () => {
    // showAgentBar guard
    expect(INPUTBAR).toMatch(/agents\.length\s*>=\s*2/);
    expect(INPUTBAR).toContain("<AgentTabBar");
  });

  it("AgentChatPage forwards agent props to InputBar", () => {
    expect(AGENT_CHAT_PAGE).toContain("activeAgentIndex");
    expect(AGENT_CHAT_PAGE).toContain("onAgentTabPress");
    // Forwarding to <InputBar ... agents={agents} ...>
    const inputBarJSX = AGENT_CHAT_PAGE.match(/<InputBar[\s\S]*?\/>/);
    expect(inputBarJSX).not.toBeNull();
    expect(inputBarJSX![0]).toContain("agents={agents}");
    expect(inputBarJSX![0]).toContain("activeAgentIndex={activeAgentIndex}");
    expect(inputBarJSX![0]).toContain("onAgentTabPress={onAgentTabPress}");
  });

  it("(tabs)/index.tsx no longer renders a top-level AgentTabBar", () => {
    expect(TABS_INDEX).not.toMatch(/<AgentTabBar[\s>]/);
  });

  it("(tabs)/index.tsx no longer imports AgentTabBar as a value", () => {
    // Comment-form references are fine ('AgentTabBar moved into InputBar')
    // — only an actual `import { AgentTabBar }` line is forbidden.
    expect(TABS_INDEX).not.toMatch(/^\s*import\s*{\s*AgentTabBar\s*}/m);
  });

  it("(tabs)/index.tsx passes agent selector wiring through AgentChatPage", () => {
    const agentChatPageJSX = TABS_INDEX.match(/<AgentChatPage[\s\S]*?\/>/);
    expect(agentChatPageJSX).not.toBeNull();
    expect(agentChatPageJSX![0]).toContain("agents={sortedAgents}");
    expect(agentChatPageJSX![0]).toContain("activeAgentIndex={activePageIndex}");
    expect(agentChatPageJSX![0]).toContain("onAgentTabPress={goToPage}");
  });

  it("headerHeight no longer reserves space for the removed AgentTabBar", () => {
    // Old: insets.top + 64 + (useInfinite ? 44 : 0)
    // New: insets.top + 64 (AppBar only)
    expect(TABS_INDEX).not.toMatch(/headerHeight\s*=.*useInfinite\s*\?\s*44/);
  });
});
