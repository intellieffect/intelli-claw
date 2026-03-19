// --- Gateway ---
export { GatewayClient, isNonRecoverableAuthError, buildDeviceAuthPayload, type ConnectionState, type GatewayClientOptions, type InvokeHandler } from "./gateway/client";
export { NodeGatewayClient } from "./gateway/node-client";
export {
  makeReq,
  parseFrame,
  type Frame,
  type ReqFrame,
  type ResFrame,
  type EventFrame,
  type ErrorShape,
  type StateVersion,
  type ClientId,
  type ClientMode,
  type ConnectClient,
  type DeviceIdentity,
  type ConnectParams,
  type HelloOkPayload,
  type PresenceEntry,
  type GatewayAgentEvent,
  type ChatSendParams,
  type ChatAbortParams,
  type ChatHistoryParams,
  type ChatEvent,
  type AgentTextDelta,
  type AgentToolCallStart,
  type AgentToolCallEnd,
  type AgentDone,
  type AgentError,
  type AgentEvent,
  type Agent,
  type Session,
  type ChatMessage,
  type ContentPart,
  type ToolCall,
  type NodeInvokeRequest,
  type NodeInvokeResult,
} from "./gateway/protocol";
export {
  signChallenge,
  clearDeviceIdentity,
  initCryptoAdapter,
  getCryptoAdapter,
} from "./gateway/device-identity";
export {
  parseSessionKey,
  sessionDisplayName,
  groupSessionsByAgent,
  type ParsedSessionKey,
  type SessionGroup,
  type GatewaySession,
} from "./gateway/session-utils";
export {
  resolveToolDisplay,
  type ToolDisplay,
} from "./gateway/tool-display";

// --- Hooks ---
export {
  GatewayProvider,
  useGateway,
  useAgents,
  onSessionReset,
  emitSessionReset,
  GATEWAY_CONFIG_STORAGE_KEY,
  DEFAULT_GATEWAY_URL,
  type GatewayProviderProps,
  type GatewayConfig,
  type SessionResetEvent,
} from "./hooks/use-gateway";
export {
  useSessionSettings,
  type SessionInfo,
  type ModelInfo,
  type ThinkingLevel,
  type VerboseLevel,
} from "./hooks/use-session-settings";
export {
  useCron,
  type CronSchedule,
  type CronPayload,
  type CronJob,
  type CronRun,
} from "./hooks/use-cron";
export {
  useSkills,
  type SkillRequirements,
  type SkillInstaller,
  type Skill,
} from "./hooks/use-skills";

// --- Adapters ---
export type { StorageAdapter } from "./adapters/storage";
export type { CryptoAdapter, CryptoKeyPairInfo } from "./adapters/crypto";
export type { PlatformAPI, MediaInfo, ShowcaseFileEntry } from "./adapters/platform";

// --- Chat Stream (shared streaming core) ---
export {
  type MutableRef,
  type DisplayAttachment,
  type ReplyTo,
  type SystemInjectedType,
  type DisplayMessage,
  type AgentStatus,
  type ToolStreamEntry,
  type ToolStreamRefs,
} from "./gateway/chat-stream-types";
export {
  createToolStreamRefs,
  resetAllStreamRefs,
  commitChatStreamToSegment,
  hasActiveStream,
  buildStreamContent,
  buildStreamToolCalls,
} from "./gateway/tool-stream";
export {
  HIDDEN_REPLY_RE,
  INTERNAL_PROMPT_RE,
  TRAILING_CONTROL_TOKEN_RE,
  stripTrailingControlTokens,
  stripInboundMeta,
  isHiddenMessage,
  shouldSuppressStreamingPreview,
  isChatStopCommand,
  isChatResetCommand,
} from "./gateway/chat-stream-core";
export {
  simpleHash,
  attachmentFingerprint,
  normalizeContentForDedup,
  deduplicateMessages,
  mergeConsecutiveAssistant,
} from "./gateway/message-utils";
export {
  ChatStreamProcessor,
  type ChatStreamCallbacks,
  type ChatStreamProcessorConfig,
} from "./gateway/chat-stream-processor";

// --- Utils ---
export { cn } from "./utils/index";
export {
  groupMessages,
  type GroupableMessage,
  type MessageGroup,
} from "./utils/message-grouping";
export {
  extractThinking,
  type ThinkingBlock,
  type ExtractThinkingResult,
} from "./utils/thinking-parser";
