// --- Gateway ---
export { GatewayClient, isNonRecoverableAuthError, type ConnectionState, type GatewayClientOptions, type InvokeHandler } from "./gateway/client";
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

// --- Utils ---
export { cn } from "./utils/index";
