"use client";

import { useState } from "react";
import { getAgentAvatar } from "@/lib/agent-avatars";
import { cn } from "@/lib/utils";

interface AgentAvatarProps {
  agentId?: string;
  size?: number;
  className?: string;
}

/**
 * 공통 에이전트 아바타 컴포넌트.
 * 이미지 로드 실패 시 이니셜 + 컬러 원으로 fallback.
 */
export function AgentAvatar({ agentId, size = 32, className }: AgentAvatarProps) {
  const av = getAgentAvatar(agentId);
  const [imgError, setImgError] = useState(false);

  if (av.imageUrl && !imgError) {
    return (
      <img
        src={av.imageUrl}
        alt=""
        className={cn("rounded-full object-cover shrink-0", className)}
        style={{ width: size, height: size }}
        onError={() => setImgError(true)}
      />
    );
  }

  return (
    <div
      className={cn("flex items-center justify-center rounded-full shrink-0", av.color, className)}
      style={{ width: size, height: size }}
    >
      <span className="font-medium" style={{ fontSize: size * 0.4 }}>{av.emoji}</span>
    </div>
  );
}
