import * as SecureStore from "expo-secure-store";

const URL_KEY = "intelliClaw.channelUrl";
const TOKEN_KEY = "intelliClaw.channelToken";

export interface SecureChannelConfig {
  url: string;
  token: string;
}

export async function loadChannelConfig(): Promise<SecureChannelConfig | null> {
  try {
    const url = await SecureStore.getItemAsync(URL_KEY);
    if (!url) return null;
    const token = (await SecureStore.getItemAsync(TOKEN_KEY)) ?? "";
    return { url, token };
  } catch {
    return null;
  }
}

export async function saveChannelConfig(config: SecureChannelConfig): Promise<void> {
  await SecureStore.setItemAsync(URL_KEY, config.url);
  if (config.token) {
    await SecureStore.setItemAsync(TOKEN_KEY, config.token);
  } else {
    await SecureStore.deleteItemAsync(TOKEN_KEY).catch(() => {});
  }
}

export async function clearChannelConfig(): Promise<void> {
  await SecureStore.deleteItemAsync(URL_KEY).catch(() => {});
  await SecureStore.deleteItemAsync(TOKEN_KEY).catch(() => {});
}
