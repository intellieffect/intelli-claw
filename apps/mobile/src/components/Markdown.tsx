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
    color: "#fafafa",
  },
  heading1: {
    fontSize: 20,
    fontWeight: "700",
    color: "#fafafa",
    marginTop: 12,
    marginBottom: 6,
  },
  heading2: {
    fontSize: 18,
    fontWeight: "700",
    color: "#fafafa",
    marginTop: 10,
    marginBottom: 4,
  },
  heading3: {
    fontSize: 16,
    fontWeight: "600",
    color: "#fafafa",
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
    color: "#FF6B35",
    textDecorationLine: "underline" as const,
  },
  blockquote: {
    backgroundColor: "#1a1a1a",
    borderLeftWidth: 3,
    borderLeftColor: "#444444",
    paddingLeft: 12,
    paddingVertical: 4,
    marginVertical: 6,
  },
  code_inline: {
    backgroundColor: "#2a2a2a",
    color: "#e5e7eb",
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    fontSize: 13,
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 4,
  },
  code_block: {
    backgroundColor: "#141414",
    color: "#d4d4d4",
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    fontSize: 12,
    lineHeight: 18,
    padding: 12,
    borderRadius: 8,
    marginVertical: 6,
    overflow: "hidden" as const,
  },
  fence: {
    backgroundColor: "#141414",
    color: "#d4d4d4",
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
    color: "#888888",
    fontSize: 14,
    marginRight: 6,
  },
  ordered_list_icon: {
    color: "#888888",
    fontSize: 13,
    marginRight: 6,
  },
  table: {
    borderWidth: 1,
    borderColor: "#333333",
    borderRadius: 6,
    marginVertical: 6,
  },
  thead: {
    backgroundColor: "#1a1a1a",
  },
  th: {
    padding: 8,
    borderBottomWidth: 1,
    borderColor: "#333333",
    fontWeight: "600",
    fontSize: 13,
  },
  td: {
    padding: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: "#222222",
    fontSize: 13,
  },
  tr: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: "#222222",
  },
  hr: {
    backgroundColor: "#2a2a2a",
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
