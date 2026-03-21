/**
 * Issue #258: AgentAvatar — agentId 변경 시 imgError 리셋 검증
 *
 * Cmd+N 새 윈도우에서 agentId가 "default" → 실제 agentId로 바뀔 때
 * 이전 이미지 로드 실패(imgError) 상태가 초기화되어야
 * 새 프로필 이미지를 정상 로드할 수 있다.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AgentAvatar } from "@/components/ui/agent-avatar";

// Mock getAgentAvatar to always return an imageUrl
vi.mock("@/lib/agent-avatars", () => ({
  getAgentAvatar: (id?: string) => ({
    emoji: (id || "??").slice(0, 2).toUpperCase(),
    color: "bg-zinc-500/20 text-zinc-400",
    imageUrl: `./agents/${(id || "unknown").toLowerCase()}.jpg`,
  }),
}));

/** Helper: find <img> inside a container (alt="" gives role=presentation, not "img") */
const findImg = (container: HTMLElement) => container.querySelector("img");

describe("Issue #258: AgentAvatar imgError reset on agentId change", () => {
  it("should reset imgError when agentId prop changes", () => {
    // 1. Render with agentId="default" — image will fail
    const { rerender, container } = render(<AgentAvatar agentId="default" size={36} />);

    let img = findImg(container);
    expect(img).not.toBeNull();
    expect(img!.getAttribute("src")).toBe("./agents/default.jpg");

    // 2. Simulate image load failure (404)
    fireEvent.error(img!);

    // After error, fallback initials should show (no <img> element)
    expect(findImg(container)).toBeNull();
    expect(screen.getByText("DE")).toBeInTheDocument();

    // 3. agentId changes to actual agent (simulating useEffect re-render)
    rerender(<AgentAvatar agentId="jarvis" size={36} />);

    // imgError should be reset — image should be attempted again
    img = findImg(container);
    expect(img).not.toBeNull();
    expect(img!.getAttribute("src")).toBe("./agents/jarvis.jpg");
  });

  it("should keep showing image if agentId stays the same (no spurious reset)", () => {
    const { rerender, container } = render(<AgentAvatar agentId="jarvis" size={36} />);

    expect(findImg(container)).not.toBeNull();
    expect(findImg(container)!.getAttribute("src")).toBe("./agents/jarvis.jpg");

    // Re-render with same agentId — should still show image
    rerender(<AgentAvatar agentId="jarvis" size={36} />);
    expect(findImg(container)).not.toBeNull();
    expect(findImg(container)!.getAttribute("src")).toBe("./agents/jarvis.jpg");
  });

  it("should fallback to initials if new agentId image also fails", () => {
    const { rerender, container } = render(<AgentAvatar agentId="default" size={36} />);

    // First agent image fails
    fireEvent.error(findImg(container)!);
    expect(findImg(container)).toBeNull();

    // Switch to new agent
    rerender(<AgentAvatar agentId="unknown-agent" size={36} />);

    // New image attempted
    const img = findImg(container);
    expect(img).not.toBeNull();
    expect(img!.getAttribute("src")).toBe("./agents/unknown-agent.jpg");

    // New image also fails
    fireEvent.error(img!);
    expect(findImg(container)).toBeNull();
    expect(screen.getByText("UN")).toBeInTheDocument();
  });
});
