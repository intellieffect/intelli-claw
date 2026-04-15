export {
  parseChannelWire,
  nextClientId,
  type ChannelConfig,
  type ChannelInfo,
  type ChannelMsg,
  type ChannelWire,
  type ClaudeSessionSummary,
  type ConnectionState,
  type PermissionRequest,
  type SendPayload,
  type SessionListResponse,
  type UploadPayload,
} from "./protocol";

export {
  ChannelClient,
  type MessageHandler,
  type StateHandler,
} from "./client";

export {
  ChannelProvider,
  useChannel,
  CHANNEL_CONFIG_STORAGE_KEY,
  CHANNEL_MESSAGES_STORAGE_KEY,
  DEFAULT_CHANNEL_URL,
  type ChannelProviderProps,
  type ChannelStorage,
} from "./hooks";
