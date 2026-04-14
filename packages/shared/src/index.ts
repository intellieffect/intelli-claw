// --- Channel (intelli-claw-channel plugin client) ---
export {
  ChannelClient,
  ChannelProvider,
  useChannel,
  parseChannelWire,
  nextClientId,
  CHANNEL_CONFIG_STORAGE_KEY,
  DEFAULT_CHANNEL_URL,
  type ChannelConfig,
  type ChannelInfo,
  type ChannelMsg,
  type ChannelWire,
  type ChannelProviderProps,
  type MessageHandler,
  type StateHandler,
  type SendPayload,
  type UploadPayload,
  type ConnectionState as ChannelConnectionState,
} from "./channel";

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
