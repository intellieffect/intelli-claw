import { useState, useEffect } from "react";
import { View, Text, Pressable, Modal, Alert, StyleSheet } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { useSafeAreaInsets } from "react-native-safe-area-context";

interface QRScannerProps {
  visible: boolean;
  onClose: () => void;
  onScanned: (data: { url: string; token: string }) => void;
}

export function QRScanner({ visible, onClose, onScanned }: QRScannerProps) {
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);

  useEffect(() => {
    if (visible) setScanned(false);
  }, [visible]);

  const handleBarCodeScanned = ({ data }: { data: string }) => {
    if (scanned) return;
    setScanned(true);

    try {
      const parsed = JSON.parse(data);
      if (!parsed.url || typeof parsed.url !== "string") {
        Alert.alert("오류", "유효하지 않은 QR 코드입니다. Gateway URL이 포함되어야 합니다.", [
          { text: "다시 스캔", onPress: () => setScanned(false) },
        ]);
        return;
      }

      // Confirm before applying
      Alert.alert(
        "Gateway 연결",
        `다음 Gateway에 연결하시겠습니까?\n\n${parsed.url}`,
        [
          { text: "취소", style: "cancel", onPress: () => setScanned(false) },
          {
            text: "연결",
            onPress: () => {
              onScanned({ url: parsed.url, token: parsed.token || "" });
              onClose();
            },
          },
        ],
      );
    } catch {
      Alert.alert("오류", "QR 코드를 읽을 수 없습니다. IntelliClaw QR 코드를 스캔해주세요.", [
        { text: "다시 스캔", onPress: () => setScanned(false) },
      ]);
    }
  };

  if (!visible) return null;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={[styles.container, { paddingTop: insets.top }]} className="bg-background">
        {/* Header */}
        <View className="flex-row items-center justify-between h-14 px-5 border-b border-border">
          <Text className="text-lg font-bold text-foreground">QR 스캔</Text>
          <Pressable onPress={onClose} hitSlop={8}>
            <Text className="text-base font-semibold text-primary">닫기</Text>
          </Pressable>
        </View>

        {!permission?.granted ? (
          <View className="flex-1 items-center justify-center px-8">
            <Text className="text-base text-foreground text-center mb-4">
              QR 코드를 스캔하려면 카메라 권한이 필요합니다
            </Text>
            <Pressable
              className="py-3 px-8 rounded-xl bg-primary items-center active:opacity-80"
              onPress={requestPermission}
            >
              <Text className="text-[15px] font-medium text-primary-foreground">권한 허용</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.cameraContainer}>
            <CameraView
              style={styles.camera}
              barcodeScannerSettings={{
                barcodeTypes: ["qr"],
              }}
              onBarcodeScanned={scanned ? undefined : handleBarCodeScanned}
            />
            {/* Overlay with scanning frame */}
            <View style={styles.overlay}>
              <View style={styles.overlayTop} />
              <View style={styles.overlayMiddle}>
                <View style={styles.overlaySide} />
                <View style={styles.scanFrame}>
                  {/* Corner markers */}
                  <View style={[styles.corner, styles.cornerTL]} />
                  <View style={[styles.corner, styles.cornerTR]} />
                  <View style={[styles.corner, styles.cornerBL]} />
                  <View style={[styles.corner, styles.cornerBR]} />
                </View>
                <View style={styles.overlaySide} />
              </View>
              <View style={styles.overlayBottom}>
                <Text className="text-sm text-white/80 text-center mt-8">
                  데스크톱 앱의 연결 설정에서{"\n"}생성된 QR 코드를 스캔하세요
                </Text>
              </View>
            </View>
          </View>
        )}
      </View>
    </Modal>
  );
}

const FRAME_SIZE = 250;

const styles = StyleSheet.create({
  container: { flex: 1 },
  cameraContainer: { flex: 1, position: "relative" },
  camera: { flex: 1 },
  overlay: {
    ...StyleSheet.absoluteFillObject,
  },
  overlayTop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
  },
  overlayMiddle: {
    flexDirection: "row",
    height: FRAME_SIZE,
  },
  overlaySide: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
  },
  scanFrame: {
    width: FRAME_SIZE,
    height: FRAME_SIZE,
    position: "relative",
  },
  overlayBottom: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    alignItems: "center",
  },
  corner: {
    position: "absolute",
    width: 24,
    height: 24,
    borderColor: "#f59e0b",
    borderWidth: 3,
  },
  cornerTL: { top: 0, left: 0, borderRightWidth: 0, borderBottomWidth: 0 },
  cornerTR: { top: 0, right: 0, borderLeftWidth: 0, borderBottomWidth: 0 },
  cornerBL: { bottom: 0, left: 0, borderRightWidth: 0, borderTopWidth: 0 },
  cornerBR: { bottom: 0, right: 0, borderLeftWidth: 0, borderTopWidth: 0 },
});
