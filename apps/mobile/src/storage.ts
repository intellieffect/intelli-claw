import { MMKV } from "react-native-mmkv";
import type { ChannelStorage } from "@intelli-claw/shared";

/**
 * MMKV-backed implementation of the shared ChannelStorage contract. Used for
 * non-secret state (messages, active session). Secrets (channel URL + bearer
 * token) go through expo-secure-store in ./secure-config.ts.
 */
const mmkv = new MMKV({ id: "intelli-claw.channel" });

export const channelStorage: ChannelStorage = {
  getItem: (key) => {
    const v = mmkv.getString(key);
    return v === undefined ? null : v;
  },
  setItem: (key, value) => mmkv.set(key, value),
  removeItem: (key) => mmkv.delete(key),
};
