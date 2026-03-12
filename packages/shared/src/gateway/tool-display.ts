/**
 * Tool Display Registry
 *
 * Maps raw tool names to human-readable labels and icon names.
 * Icon names correspond to Lucide React icon component names.
 */

export type ToolDisplay = {
  /** Human-readable label for the tool */
  label: string;
  /** Lucide icon component name (e.g. "FileText", "Terminal") */
  iconName: string;
};

type ToolDisplayEntry = {
  label: string;
  iconName: string;
};

/**
 * Registry of known tool names → display info.
 * Keys are lowercase for case-insensitive lookup.
 */
const TOOL_REGISTRY: Record<string, ToolDisplayEntry> = {
  // File reading
  read_file: { label: "Read File", iconName: "FileText" },
  read: { label: "Read", iconName: "FileText" },

  // File writing
  write_file: { label: "Write File", iconName: "FilePen" },
  write: { label: "Write", iconName: "FilePen" },
  create_file: { label: "Create File", iconName: "FilePlus" },

  // File editing
  edit_file: { label: "Edit File", iconName: "FileEdit" },
  edit: { label: "Edit", iconName: "FileEdit" },

  // Terminal / execution
  execute_bash: { label: "Terminal", iconName: "Terminal" },
  bash: { label: "Terminal", iconName: "Terminal" },
  exec: { label: "Terminal", iconName: "Terminal" },

  // Search
  search: { label: "Search", iconName: "Search" },
  grep: { label: "Search", iconName: "Search" },

  // Web
  web_fetch: { label: "Web Fetch", iconName: "Globe" },
  web_search: { label: "Web Search", iconName: "Search" },

  // Directory listing
  list_dir: { label: "List Files", iconName: "FolderOpen" },
  glob: { label: "List Files", iconName: "FolderOpen" },

  // Browser
  browser: { label: "Browser", iconName: "Globe" },

  // PDF
  pdf: { label: "PDF", iconName: "FileText" },

  // Attachments
  attach: { label: "Attach", iconName: "Paperclip" },

  // Process management
  process: { label: "Process", iconName: "Cog" },

  // Scheduling
  cron: { label: "Cron", iconName: "Clock" },

  // Agents
  sessions_spawn: { label: "Spawn Agent", iconName: "Bot" },
  subagents: { label: "Subagent", iconName: "Bot" },

  // Canvas
  canvas: { label: "Canvas", iconName: "PaintbrushVertical" },

  // Nodes (devices)
  nodes: { label: "Nodes", iconName: "Smartphone" },

  // Gateway
  gateway: { label: "Gateway", iconName: "Plug" },

  // Messaging
  discord: { label: "Discord", iconName: "MessageSquare" },
  slack: { label: "Slack", iconName: "MessageSquare" },
};

const FALLBACK_ICON = "Wrench";

/**
 * Resolve a tool name to a human-readable label and icon name.
 *
 * Lookup is case-insensitive. Unknown tools return the original name
 * as the label with a "Wrench" fallback icon.
 */
export function resolveToolDisplay(toolName: string): ToolDisplay {
  const key = toolName.toLowerCase();
  const entry = TOOL_REGISTRY[key];
  if (entry) {
    return { label: entry.label, iconName: entry.iconName };
  }
  return { label: toolName, iconName: FALLBACK_ICON };
}
