import React from "react";
import { Platform, ScrollView, View, StyleSheet } from "react-native";
import MarkdownDisplay from "react-native-markdown-display";

const rules = {
  // Suppress <body> wrapper to avoid nesting issues
  body: (node: any, children: any) => children,
  // Wrap tables in horizontal ScrollView to prevent column squishing on narrow screens
  table: (node: any, children: any) => (
    <ScrollView
      key={node.key}
      horizontal
      showsHorizontalScrollIndicator
      style={{ marginVertical: 6 }}
      contentContainerStyle={{ flexGrow: 1 }}
    >
      <View style={{ minWidth: 320 }}>
        {children}
      </View>
    </ScrollView>
  ),
};

const markdownStyles = StyleSheet.create({
  body: {
    fontSize: 15,
    lineHeight: 22,
    color: "#111827",
  },
  heading1: {
    fontSize: 20,
    fontWeight: "700",
    color: "#111827",
    marginTop: 12,
    marginBottom: 6,
  },
  heading2: {
    fontSize: 18,
    fontWeight: "700",
    color: "#111827",
    marginTop: 10,
    marginBottom: 4,
  },
  heading3: {
    fontSize: 16,
    fontWeight: "600",
    color: "#111827",
    marginTop: 8,
    marginBottom: 4,
  },
  paragraph: {
    marginTop: 0,
    marginBottom: 6,
  },
  strong: {
    fontWeight: "700",
  },
  em: {
    fontStyle: "italic",
  },
  link: {
    color: "#2563EB",
    textDecorationLine: "underline" as const,
  },
  blockquote: {
    backgroundColor: "#F9FAFB",
    borderLeftWidth: 3,
    borderLeftColor: "#D1D5DB",
    paddingLeft: 12,
    paddingVertical: 4,
    marginVertical: 6,
  },
  code_inline: {
    backgroundColor: "#E5E7EB",
    color: "#1F2937",
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    fontSize: 13,
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 4,
  },
  code_block: {
    backgroundColor: "#1F2937",
    color: "#E5E7EB",
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    fontSize: 12,
    lineHeight: 18,
    padding: 12,
    borderRadius: 8,
    marginVertical: 6,
    overflow: "hidden" as const,
  },
  fence: {
    backgroundColor: "#1F2937",
    color: "#E5E7EB",
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    fontSize: 12,
    lineHeight: 18,
    padding: 12,
    borderRadius: 8,
    marginVertical: 6,
    overflow: "hidden" as const,
  },
  bullet_list: {
    marginVertical: 4,
  },
  ordered_list: {
    marginVertical: 4,
  },
  list_item: {
    marginVertical: 2,
  },
  bullet_list_icon: {
    color: "#6B7280",
    fontSize: 14,
    marginRight: 6,
  },
  ordered_list_icon: {
    color: "#6B7280",
    fontSize: 13,
    marginRight: 6,
  },
  table: {
    borderWidth: 1,
    borderColor: "#E5E7EB",
    borderRadius: 6,
    marginVertical: 6,
  },
  thead: {
    backgroundColor: "#F9FAFB",
  },
  th: {
    padding: 8,
    borderBottomWidth: 1,
    borderColor: "#E5E7EB",
    fontWeight: "600",
    fontSize: 13,
  },
  td: {
    padding: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: "#F3F4F6",
    fontSize: 13,
  },
  tr: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: "#F3F4F6",
  },
  hr: {
    backgroundColor: "#E5E7EB",
    height: 1,
    marginVertical: 12,
  },
  image: {
    borderRadius: 8,
    marginVertical: 6,
  },
});

export function Markdown({ children }: { children: string }) {
  if (!children) return null;
  return (
    <MarkdownDisplay style={markdownStyles as any} rules={rules}>
      {children}
    </MarkdownDisplay>
  );
}
