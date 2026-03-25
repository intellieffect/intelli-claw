// Re-export from shared for backward compatibility
export {
  type ToolStreamRefs,
  type ToolStreamEntry,
  type MessageSegment,
  createToolStreamRefs,
  resetAllStreamRefs,
  commitChatStreamToSegment,
  hasActiveStream,
  buildStreamContent,
  buildStreamToolCalls,
  buildStreamSegments,
} from "@intelli-claw/shared";
