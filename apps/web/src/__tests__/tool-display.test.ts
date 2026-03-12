import { describe, it, expect } from "vitest";
import { resolveToolDisplay } from "@/lib/gateway/tool-display";

describe("resolveToolDisplay", () => {
  describe("known tool mappings", () => {
    it("maps read_file to Read File with FileText icon", () => {
      const result = resolveToolDisplay("read_file");
      expect(result).toEqual({ label: "Read File", iconName: "FileText" });
    });

    it("maps write_file to Write File with FilePen icon", () => {
      const result = resolveToolDisplay("write_file");
      expect(result).toEqual({ label: "Write File", iconName: "FilePen" });
    });

    it("maps execute_bash to Terminal with Terminal icon", () => {
      const result = resolveToolDisplay("execute_bash");
      expect(result).toEqual({ label: "Terminal", iconName: "Terminal" });
    });

    it("maps bash to Terminal with Terminal icon", () => {
      const result = resolveToolDisplay("bash");
      expect(result).toEqual({ label: "Terminal", iconName: "Terminal" });
    });

    it("maps search to Search with Search icon", () => {
      const result = resolveToolDisplay("search");
      expect(result).toEqual({ label: "Search", iconName: "Search" });
    });

    it("maps grep to Search with Search icon", () => {
      const result = resolveToolDisplay("grep");
      expect(result).toEqual({ label: "Search", iconName: "Search" });
    });

    it("maps web_fetch to Web Fetch with Globe icon", () => {
      const result = resolveToolDisplay("web_fetch");
      expect(result).toEqual({ label: "Web Fetch", iconName: "Globe" });
    });

    it("maps web_search to Web Search with Search icon", () => {
      const result = resolveToolDisplay("web_search");
      expect(result).toEqual({ label: "Web Search", iconName: "Search" });
    });

    it("maps list_dir to List Files with FolderOpen icon", () => {
      const result = resolveToolDisplay("list_dir");
      expect(result).toEqual({ label: "List Files", iconName: "FolderOpen" });
    });

    it("maps glob to List Files with FolderOpen icon", () => {
      const result = resolveToolDisplay("glob");
      expect(result).toEqual({ label: "List Files", iconName: "FolderOpen" });
    });

    it("maps edit_file to Edit File with FileEdit icon", () => {
      const result = resolveToolDisplay("edit_file");
      expect(result).toEqual({ label: "Edit File", iconName: "FileEdit" });
    });

    it("maps edit to Edit with FileEdit icon", () => {
      const result = resolveToolDisplay("edit");
      expect(result).toEqual({ label: "Edit", iconName: "FileEdit" });
    });

    it("maps create_file to Create File with FilePlus icon", () => {
      const result = resolveToolDisplay("create_file");
      expect(result).toEqual({ label: "Create File", iconName: "FilePlus" });
    });

    it("maps write to Write with FilePen icon", () => {
      const result = resolveToolDisplay("write");
      expect(result).toEqual({ label: "Write", iconName: "FilePen" });
    });

    it("maps read to Read with FileText icon", () => {
      const result = resolveToolDisplay("read");
      expect(result).toEqual({ label: "Read", iconName: "FileText" });
    });

    it("maps exec to Terminal with Terminal icon", () => {
      const result = resolveToolDisplay("exec");
      expect(result).toEqual({ label: "Terminal", iconName: "Terminal" });
    });

    it("maps browser to Browser with Globe icon", () => {
      const result = resolveToolDisplay("browser");
      expect(result).toEqual({ label: "Browser", iconName: "Globe" });
    });

    it("maps pdf to PDF with FileText icon", () => {
      const result = resolveToolDisplay("pdf");
      expect(result).toEqual({ label: "PDF", iconName: "FileText" });
    });

    it("maps attach to Attach with Paperclip icon", () => {
      const result = resolveToolDisplay("attach");
      expect(result).toEqual({ label: "Attach", iconName: "Paperclip" });
    });

    it("maps process to Process with Cog icon", () => {
      const result = resolveToolDisplay("process");
      expect(result).toEqual({ label: "Process", iconName: "Cog" });
    });

    it("maps cron to Cron with Clock icon", () => {
      const result = resolveToolDisplay("cron");
      expect(result).toEqual({ label: "Cron", iconName: "Clock" });
    });

    it("maps sessions_spawn to Spawn Agent with Bot icon", () => {
      const result = resolveToolDisplay("sessions_spawn");
      expect(result).toEqual({ label: "Spawn Agent", iconName: "Bot" });
    });

    it("maps subagents to Subagent with Bot icon", () => {
      const result = resolveToolDisplay("subagents");
      expect(result).toEqual({ label: "Subagent", iconName: "Bot" });
    });

    it("maps canvas to Canvas with PaintbrushVertical icon", () => {
      const result = resolveToolDisplay("canvas");
      expect(result).toEqual({ label: "Canvas", iconName: "PaintbrushVertical" });
    });

    it("maps nodes to Nodes with Smartphone icon", () => {
      const result = resolveToolDisplay("nodes");
      expect(result).toEqual({ label: "Nodes", iconName: "Smartphone" });
    });

    it("maps gateway to Gateway with Plug icon", () => {
      const result = resolveToolDisplay("gateway");
      expect(result).toEqual({ label: "Gateway", iconName: "Plug" });
    });

    it("maps discord to Discord with MessageSquare icon", () => {
      const result = resolveToolDisplay("discord");
      expect(result).toEqual({ label: "Discord", iconName: "MessageSquare" });
    });

    it("maps slack to Slack with MessageSquare icon", () => {
      const result = resolveToolDisplay("slack");
      expect(result).toEqual({ label: "Slack", iconName: "MessageSquare" });
    });
  });

  describe("case-insensitive matching", () => {
    it("matches READ_FILE in uppercase", () => {
      const result = resolveToolDisplay("READ_FILE");
      expect(result).toEqual({ label: "Read File", iconName: "FileText" });
    });

    it("matches Bash in mixed case", () => {
      const result = resolveToolDisplay("Bash");
      expect(result).toEqual({ label: "Terminal", iconName: "Terminal" });
    });

    it("matches WEB_FETCH in uppercase", () => {
      const result = resolveToolDisplay("WEB_FETCH");
      expect(result).toEqual({ label: "Web Fetch", iconName: "Globe" });
    });

    it("matches Edit_File in mixed case", () => {
      const result = resolveToolDisplay("Edit_File");
      expect(result).toEqual({ label: "Edit File", iconName: "FileEdit" });
    });
  });

  describe("fallback for unknown tools", () => {
    it("returns tool name as label with Wrench icon for unknown tool", () => {
      const result = resolveToolDisplay("custom_magic_tool");
      expect(result).toEqual({ label: "custom_magic_tool", iconName: "Wrench" });
    });

    it("returns original name for completely unknown tools", () => {
      const result = resolveToolDisplay("xyz_unknown");
      expect(result).toEqual({ label: "xyz_unknown", iconName: "Wrench" });
    });

    it("handles empty string", () => {
      const result = resolveToolDisplay("");
      expect(result).toEqual({ label: "", iconName: "Wrench" });
    });
  });
});
