import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  Image,
  ScrollView,
  Platform,
  ActionSheetIOS,
  StyleSheet,
} from "react-native";
import * as ImagePicker from "expo-image-picker";

// ─── Types ───

export interface MobileAttachment {
  id: string;
  uri: string;
  base64?: string;
  mimeType: string;
  fileName: string;
}

// ─── Attachment Preview Bar ───

export function AttachmentPreview({
  attachments,
  onRemove,
}: {
  attachments: MobileAttachment[];
  onRemove: (id: string) => void;
}) {
  if (attachments.length === 0) return null;

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.previewBar}
      contentContainerStyle={styles.previewContent}
    >
      {attachments.map((att) => (
        <View key={att.id} style={styles.thumbWrap}>
          <Image source={{ uri: att.uri }} style={styles.thumbImg} />
          <TouchableOpacity
            style={styles.removeBtn}
            onPress={() => onRemove(att.id)}
            activeOpacity={0.7}
          >
            <Text style={styles.removeText}>✕</Text>
          </TouchableOpacity>
          <Text style={styles.thumbName} numberOfLines={1}>
            {att.fileName}
          </Text>
        </View>
      ))}
    </ScrollView>
  );
}

// ─── Attach Button ───

export function AttachButton({
  onAttach,
  disabled,
}: {
  onAttach: (attachments: MobileAttachment[]) => void;
  disabled?: boolean;
}) {
  const pickFromGallery = useCallback(async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.8,
      base64: true,
      allowsMultipleSelection: true,
      selectionLimit: 5,
    });
    if (!result.canceled) {
      const atts: MobileAttachment[] = result.assets.map((asset) => ({
        id: `att-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        uri: asset.uri,
        base64: asset.base64 || undefined,
        mimeType: asset.mimeType || "image/jpeg",
        fileName: asset.fileName || `photo-${Date.now()}.jpg`,
      }));
      onAttach(atts);
    }
  }, [onAttach]);

  const takePhoto = useCallback(async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return;
    const result = await ImagePicker.launchCameraAsync({
      quality: 0.8,
      base64: true,
    });
    if (!result.canceled && result.assets[0]) {
      const asset = result.assets[0];
      onAttach([
        {
          id: `att-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          uri: asset.uri,
          base64: asset.base64 || undefined,
          mimeType: asset.mimeType || "image/jpeg",
          fileName: asset.fileName || `photo-${Date.now()}.jpg`,
        },
      ]);
    }
  }, [onAttach]);

  const handlePress = useCallback(() => {
    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: ["취소", "갤러리에서 선택", "카메라로 촬영"],
          cancelButtonIndex: 0,
        },
        (idx) => {
          if (idx === 1) pickFromGallery();
          else if (idx === 2) takePhoto();
        },
      );
    } else {
      pickFromGallery();
    }
  }, [pickFromGallery, takePhoto]);

  return (
    <TouchableOpacity
      onPress={handlePress}
      style={styles.attachBtn}
      activeOpacity={0.7}
      disabled={disabled}
    >
      <Text style={[styles.attachIcon, disabled && styles.attachIconDisabled]}>
        📎
      </Text>
    </TouchableOpacity>
  );
}

// ─── Hook: useFileAttachments ───

export function useFileAttachments() {
  const [attachments, setAttachments] = useState<MobileAttachment[]>([]);

  const addAttachments = useCallback((newAtts: MobileAttachment[]) => {
    setAttachments((prev) => [...prev, ...newAtts]);
  }, []);

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const clearAttachments = useCallback(() => {
    setAttachments([]);
  }, []);

  /** Convert to the payload format expected by useChat sendMessage */
  const toPayloads = useCallback(() => {
    return attachments
      .filter((a) => a.base64)
      .map((a) => ({
        content: a.base64!,
        mimeType: a.mimeType,
        fileName: a.fileName,
      }));
  }, [attachments]);

  const imageUris = useCallback(() => {
    return attachments.map((a) => a.uri);
  }, [attachments]);

  return {
    attachments,
    addAttachments,
    removeAttachment,
    clearAttachments,
    toPayloads,
    imageUris,
  };
}

// ─── Styles ───

const styles = StyleSheet.create({
  previewBar: {
    backgroundColor: "#FFFFFF",
    borderTopWidth: 1,
    borderTopColor: "#F3F4F6",
  },
  previewContent: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
  },
  thumbWrap: {
    position: "relative",
    alignItems: "center",
    width: 68,
  },
  thumbImg: {
    width: 60,
    height: 60,
    borderRadius: 8,
    backgroundColor: "#F3F4F6",
  },
  removeBtn: {
    position: "absolute",
    top: -4,
    right: 0,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: "#EF4444",
    alignItems: "center",
    justifyContent: "center",
  },
  removeText: {
    color: "#FFFFFF",
    fontSize: 10,
    fontWeight: "700",
  },
  thumbName: {
    fontSize: 9,
    color: "#9CA3AF",
    marginTop: 2,
    maxWidth: 60,
    textAlign: "center",
  },
  attachBtn: {
    paddingHorizontal: 4,
    paddingVertical: 8,
    justifyContent: "center",
  },
  attachIcon: {
    fontSize: 20,
  },
  attachIconDisabled: {
    opacity: 0.4,
  },
});
