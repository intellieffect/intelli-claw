import { useEffect, useRef } from "react";
import { Alert } from "react-native";
import * as Linking from "expo-linking";
import { useGateway } from "@intelli-claw/shared";
import { validateGatewayUrl, normalizeToken } from "../lib/validate-gateway-url";

/**
 * Handles `intelli-claw://connect?url=<encoded>&token=<encoded>` deep links.
 * Must be used inside GatewayProvider.
 */
export function useDeepLink() {
  const { updateConfig } = useGateway();
  const handled = useRef(new Set<string>());

  useEffect(() => {
    function handleUrl(event: { url: string }) {
      const { url } = event;
      if (!url) return;

      // Deduplicate: same URL within this session
      if (handled.current.has(url)) return;
      handled.current.add(url);

      const parsed = Linking.parse(url);
      // Only handle "connect" path under intelli-claw:// scheme
      if (parsed.hostname !== "connect" && parsed.path !== "connect") return;

      // #268: Same defensive validation as QR scanner — trim whitespace,
      // require wss:// or ws:// scheme, reject malformed hosts.
      const validation = validateGatewayUrl(parsed.queryParams?.url);
      if (!validation.ok) {
        Alert.alert("오류", validation.error ?? "Deep Link에 유효한 Gateway URL이 포함되어 있지 않습니다.");
        return;
      }
      const cleanUrl = validation.url!;
      const cleanToken = normalizeToken(parsed.queryParams?.token);

      Alert.alert(
        "Gateway 연결",
        `다음 Gateway에 연결하시겠습니까?\n\n${cleanUrl}`,
        [
          { text: "취소", style: "cancel" },
          {
            text: "연결",
            onPress: () => {
              updateConfig(cleanUrl, cleanToken);
              Alert.alert("연결됨", "Deep Link에서 읽은 Gateway 설정이 적용되었습니다. 재연결 중...");
            },
          },
        ],
      );
    }

    // Handle URL that opened the app (cold start)
    Linking.getInitialURL().then((url) => {
      if (url) handleUrl({ url });
    });

    // Handle URLs while app is running (warm start)
    const subscription = Linking.addEventListener("url", handleUrl);
    return () => subscription.remove();
  }, [updateConfig]);
}
